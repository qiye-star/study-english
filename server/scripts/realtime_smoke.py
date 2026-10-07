"""实时通话服务端冒烟(真实上游,计划 Task 5.2 的服务端部分)。

本脚本不启动任何服务:对 --base-url 指向的、已开启 REALTIME_ENABLED 的服务运行 5 个场景:
  1. 一整轮:按实时节奏(100 ms/帧)上传真实语音 → transcript_partial/final → reply_delta →
     下行音频(turn_id 头 + 24 kHz PCM)→ reply_done →(讯飞已配置时)assessment;再核对已保存的消息。
  2. 打断:机器人说话时上传第二句 → 旧一轮 reply_done{interrupted} 之后不再有旧 turn_id 的音频,
     助手消息以 " …" 结尾保存。
  3. 挂断:回复中途 hangup(以及直接断开连接)→ 立即用新 ticket 重连能拿到 ready(不是 4029)。
  4. 同一用户第二路并发 → 4029,第一路不受影响。
  5. 无效 / 缺失 / 重复使用的 ticket → 4001。
  6. 用户挂断时还有待完成的识别 / 评测:
     6a. `utterance_end` 之后立即 hangup → 关闭帧 ≤ 3 s;用户消息已保存(transcript_final 在关闭帧前到达),
         挂断后没有任何回复(reply_delta / 音频 / reply_done),也没有保存助手消息;(讯飞已配置时)
         `assessment` 在关闭帧之前到达。
     6b. 收到 transcript_final 后立即 hangup(只剩评测待完成)→ 关闭帧 ≤ 3 s,`assessment` 在关闭帧之前到达。
  (7. 静音超时立即挂断:要等 60 s,不在本脚本内。)
  8. LLM 首字:各场景里每个 transcript_final → 下一个 reply_delta 的间隔汇总到 8_llm_first_delta_ms;
     --print-thinking 在进程内用 Settings()(读 cwd 下的 .env)打印实时通话是否会发送
     `thinking: disabled`(只打印布尔值,不打印地址或密钥)。

测试语音由服务自己的 TTS 接口(/api/ai/audio/speech,mp3)生成,用本机 ffmpeg 转成 16 kHz PCM16LE
(与 scripts/eval_free_speech.py 的转换参数相同);--pcm-cache 可复用上次生成的 PCM,不再调用 TTS。

只打印测试句的转写;回复只打印长度与统计,不打印内容;不打印 ticket、token 或密钥。

Usage(服务需已运行):
    cd server && uv run python scripts/realtime_smoke.py --base-url http://127.0.0.1:8025 \
        --pcm-cache <scratch>/speech16k.pcm --expect-assessment --server-log <server log>
"""
import argparse
import asyncio
import json
import re
import secrets
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

SENTENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
RATE_IN = 16000
FRAME_MS = 100
FRAME = RATE_IN * 2 * FRAME_MS // 1000  # 3200 bytes
TAIL_SILENCE_S = 0.3
SHORT_PROMPT = "You are a friendly barista in a cafe. Reply in two or three short sentences."
LONG_PROMPT = ("You are a friendly barista in a cafe. Reply in six short sentences: greet the customer, "
               "describe three coffees on the menu, and ask which one they want.")
BARGE_AFTER_AUDIO_S = 3.0  # 打断前至少收到这么多秒下行音频(让第一句完整下发,才会保存 " …")
LEAK_MARKERS = re.compile(r"<think|</think|reasoning|\bthinking\b", re.I)


class Failure(Exception):
    pass


def check(cond: bool, message: str) -> None:
    if not cond:
        raise Failure(message)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z']+", text.lower())


def word_match(ref: str, hyp: str) -> float:
    """参考词按顺序在识别结果里出现的比例(LCS / 参考词数)。"""
    a, b = words(ref), words(hyp)
    if not a:
        return 0.0
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a)):
        for j in range(len(b)):
            dp[i + 1][j + 1] = dp[i][j] + 1 if a[i] == b[j] else max(dp[i][j + 1], dp[i + 1][j])
    return dp[-1][-1] / len(a)


def ms(t: float | None, since: float) -> int | None:
    return None if t is None else round((t - since) * 1000)


# ---- HTTP ----

class Api:
    def __init__(self, base_url: str):
        self.http = httpx.AsyncClient(base_url=base_url, timeout=120)
        self.headers: dict = {}
        self.ws_base = re.sub(r"^http", "ws", base_url.rstrip("/"))

    async def ok(self, method: str, path: str, **kw) -> dict:
        r = await self.http.request(method, path, headers=self.headers, **kw)
        if r.status_code >= 400:
            raise Failure(f"{method} {path} → {r.status_code} {r.text[:200]}")
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else {"_bytes": r.content}

    async def register(self) -> str:
        name = "rtsmoke_" + secrets.token_hex(4)
        body = await self.ok("POST", "/api/users", json={"username": name, "password": "password-" + secrets.token_hex(6)})
        self.headers = {"Authorization": f"Bearer {body['access_token']}"}
        return name

    async def conversation(self) -> str:
        return (await self.ok("POST", "/api/conversations", json={"name": "realtime smoke"}))["id"]

    async def ticket(self, conversation_id: str) -> str:
        return (await self.ok("POST", "/api/realtime/ticket", json={"conversation_id": conversation_id}))["ticket"]

    async def messages(self, conversation_id: str) -> list[dict]:
        return (await self.ok("GET", f"/api/conversations/{conversation_id}/messages"))["messages"]

    async def speech_pcm(self, model: str, voice: str) -> bytes:
        r = await self.http.post("/api/ai/audio/speech", headers=self.headers,
                                 json={"input": SENTENCE, "model": model, "voice": voice})
        if r.status_code != 200:
            raise Failure(f"TTS for the test sentence → {r.status_code}")
        if shutil.which("ffmpeg") is None:
            raise Failure("ffmpeg not found on PATH")
        done = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(RATE_IN), "-f", "s16le", "pipe:1"],
            input=r.content, capture_output=True, check=True)
        return done.stdout


# ---- WebSocket ----

class Call:
    """One WebSocket; a reader task records every downlink event with its arrival time."""

    def __init__(self, ws):
        self.ws = ws
        self.events: list[tuple[float, str, dict]] = []
        self.cond = asyncio.Condition()
        self.close_code: int | None = None
        self.reader = asyncio.create_task(self._read())

    @classmethod
    async def open(cls, api: Api, ticket: str | None) -> "Call":
        url = f"{api.ws_base}/api/realtime" + (f"?ticket={ticket}" if ticket is not None else "")
        ws = await connect(url, max_size=2**22, open_timeout=15)
        return cls(ws)

    async def _push(self, t: float, kind: str, data: dict) -> None:
        async with self.cond:
            self.events.append((t, kind, data))
            self.cond.notify_all()

    async def _read(self) -> None:
        try:
            async for msg in self.ws:
                t = time.monotonic()
                if isinstance(msg, bytes):
                    (turn_id,) = struct.unpack(">I", msg[:4])
                    await self._push(t, "audio", {"turn_id": turn_id, "bytes": len(msg) - 4})
                else:
                    data = json.loads(msg)
                    await self._push(t, data.get("type", "?"), data)
        except ConnectionClosed:
            pass
        finally:
            self.close_code = self.ws.close_code
            await self._push(time.monotonic(), "closed", {"code": self.close_code})

    def find(self, kind: str, pred=lambda d: True, after: int = 0) -> int | None:
        for i in range(after, len(self.events)):
            if self.events[i][1] == kind and pred(self.events[i][2]):
                return i
        return None

    async def wait(self, kind: str, pred=lambda d: True, after: int = 0, timeout: float = 60.0) -> int:
        """Index of the first matching event at or after `after`; Failure on timeout or close."""
        async def ready():
            async with self.cond:
                await self.cond.wait_for(lambda: self.find(kind, pred, after) is not None
                                         or (kind != "closed" and self.find("closed", after=after) is not None))
        try:
            await asyncio.wait_for(ready(), timeout)
        except TimeoutError:
            raise Failure(f"timed out after {timeout:.0f} s waiting for {kind}") from None
        i = self.find(kind, pred, after)
        if i is None:
            raise Failure(f"connection closed with {self.close_code} while waiting for {kind}")
        return i

    def t(self, i: int | None) -> float | None:
        return None if i is None else self.events[i][0]

    async def send_json(self, data: dict) -> None:
        await self.ws.send(json.dumps(data))

    async def start(self, voice: str, model: str, prompt: str) -> None:
        try:
            await self.send_json({"type": "start", "system_prompt": prompt, "model": model, "temperature": 0.7,
                                  "voice": voice, "language": "en", "save_recordings": True})
        except ConnectionClosed:
            pass  # already closed (e.g. 4029 sent right after accept): the next wait() reports the close code

    async def speak(self, pcm: bytes) -> tuple[float, float]:
        """Stream `pcm` + tail silence in 100 ms frames on an absolute real-time schedule, then
        utterance_end. Returns (first frame sent, utterance_end sent)."""
        data = pcm + bytes(int(TAIL_SILENCE_S * RATE_IN) * 2)
        t0 = time.monotonic()
        for n, i in enumerate(range(0, len(data), FRAME)):
            delay = t0 + n * FRAME_MS / 1000 - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            await self.ws.send(data[i:i + FRAME])
        delay = t0 + len(range(0, len(data), FRAME)) * FRAME_MS / 1000 - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        await self.send_json({"type": "utterance_end"})
        return t0, time.monotonic()

    def llm_gaps(self) -> list[int]:
        """ms from each saved transcript_final to the next reply_delta (LLM first token + server overhead)."""
        gaps = []
        for i, (t, kind, data) in enumerate(self.events):
            if kind == "transcript_final" and data.get("message_id"):
                j = self.find("reply_delta", after=i + 1)
                if j is not None:
                    gaps.append(ms(self.events[j][0], t))
        return gaps

    def reply_sentences(self) -> int:
        """Rough count of reply sentences the server sent to TTS (for the upstream budget)."""
        text = "".join(d["text"] for _, k, d in self.events if k == "reply_delta")
        ended = len(re.findall(r"[.!?]+(?:\s|$)", text))
        return ended + (1 if text.strip() and not re.search(r"[.!?]\s*$", text) else 0)

    def tally(self, ctx: dict) -> None:
        ctx.setdefault("llm_gaps", []).extend(self.llm_gaps())
        ctx["tts_sentences"] = ctx.get("tts_sentences", 0) + self.reply_sentences()

    async def hangup(self, timeout: float = 20.0) -> int | None:
        with_hangup = self.close_code is None
        if with_hangup:
            try:
                await self.send_json({"type": "hangup"})
            except ConnectionClosed:
                pass
        await self.wait("closed", timeout=timeout)
        return self.close_code

    def audio_seconds(self, turn_id: int) -> float:
        return sum(d["bytes"] for _, k, d in self.events if k == "audio" and d["turn_id"] == turn_id) / 48000


async def expect_close(api: Api, ticket: str | None, code: int) -> int | None:
    call = await Call.open(api, ticket)
    await call.wait("closed", timeout=15)
    check(call.close_code == code, f"expected close {code}, got {call.close_code}")
    return call.close_code


async def open_ready(api: Api, conversation_id: str, ctx: dict, prompt: str) -> Call:
    call = await Call.open(api, await api.ticket(conversation_id))
    await call.start(ctx["voice"], ctx["model"], prompt)
    i = await call.wait("ready", timeout=20)
    ctx.setdefault("ready_asr", call.events[i][2].get("asr"))
    return call


# ---- scenarios ----

async def scenario_turn(api: Api, ctx: dict) -> dict:
    conv = await api.conversation()
    call = await open_ready(api, conv, ctx, SHORT_PROMPT)
    t0, t_end = await call.speak(ctx["pcm"])
    i_final = await call.wait("transcript_final", timeout=60)
    final = call.events[i_final][2]
    i_reply_done = await call.wait("reply_done", after=i_final, timeout=90)
    done = call.events[i_reply_done][2]
    turn_id = done["turn_id"]
    i_partial = call.find("transcript_partial")
    i_delta = call.find("reply_delta", after=i_final)
    i_audio = call.find("audio", after=i_final)
    reply = "".join(d["text"] for _, k, d in call.events if k == "reply_delta" and d["turn_id"] == turn_id)
    out = {
        "conversation": "ok",
        "transcript_final": final["text"],
        "word_match": round(word_match(SENTENCE, final["text"]), 2),
        "partials": sum(1 for _, k, _ in call.events if k == "transcript_partial"),
        "first_partial_ms_after_audio_start": ms(call.t(i_partial), t0),
        "first_partial_ms_after_utterance_end": ms(call.t(i_partial), t_end),
        "final_ms_after_utterance_end": ms(call.t(i_final), t_end),
        "first_reply_delta_ms_after_utterance_end": ms(call.t(i_delta), t_end),
        "first_audio_ms_after_utterance_end": ms(call.t(i_audio), t_end),
        "first_audio_turn_id_matches": i_audio is not None and call.events[i_audio][2]["turn_id"] == turn_id,
        "reply_done_ms_after_utterance_end": ms(call.t(i_reply_done), t_end),
        "reply_chars": len(reply),
        "reply_audio_s": round(call.audio_seconds(turn_id), 2),
        "reply_interrupted": done["interrupted"],
        "reply_has_reasoning_markers": bool(LEAK_MARKERS.search(reply)),
        "errors": [d.get("code") for _, k, d in call.events if k == "error"],
        "degraded": call.find("degraded") is not None,
        "states": [d["state"] for _, k, d in call.events if k == "state"],
    }
    check(final["text"].strip() != "" and final["message_id"], "empty transcript_final")
    check(i_audio is not None, "no downlink audio")
    check(out["first_audio_turn_id_matches"], "first audio frame has another turn_id")
    check(not done["interrupted"] and done["message_id"], "reply_done not a complete saved reply")
    if ctx["expect_assessment"]:
        try:
            i_a = await call.wait("assessment", timeout=45)
            a = call.events[i_a][2]
            score = (a.get("result") or {}).get("pronunciation_score") if isinstance(a.get("result"), dict) else None
            out.update(assessment_status=a.get("status"), assessment_ms_after_utterance_end=ms(call.t(i_a), t_end),
                       assessment_saved=bool(a.get("assessment_id")), pronunciation_score=score,
                       assessment_message_matches=a.get("message_id") == final["message_id"])
        except Failure as e:
            out["assessment_status"] = f"missing ({e})"
    out["close"] = await call.hangup()
    call.tally(ctx)
    msgs = await api.messages(conv)
    out["saved"] = [(m["role"], len(m["content"])) for m in msgs]
    check([m["role"] for m in msgs] == ["user", "assistant"], f"saved roles {[m['role'] for m in msgs]}")
    check(msgs[0]["content"] == final["text"], "saved user message differs from transcript_final")
    check(msgs[0]["id"] == final["message_id"] and msgs[1]["id"] == done["message_id"], "message ids differ")
    check(msgs[1]["content"] == reply.strip(), "saved assistant message differs from the streamed reply")
    if ctx["expect_assessment"] and out.get("assessment_saved"):
        out["user_message_has_assessment"] = msgs[0]["assessment_id"] is not None
    check(out["close"] == 1000, f"close {out['close']}")
    if ctx["expect_assessment"]:
        check(out.get("assessment_status") == "done", f"assessment {out.get('assessment_status')}")
    return out


async def scenario_barge_in(api: Api, ctx: dict) -> dict:
    conv = await api.conversation()
    call = await open_ready(api, conv, ctx, LONG_PROMPT)
    _, t_end = await call.speak(ctx["pcm"])
    i_final = await call.wait("transcript_final", timeout=60)
    i_audio = await call.wait("audio", after=i_final, timeout=60)
    old = call.events[i_audio][2]["turn_id"]

    async def enough_audio():
        async with call.cond:
            await call.cond.wait_for(lambda: call.audio_seconds(old) >= BARGE_AFTER_AUDIO_S
                                     or call.find("reply_done", lambda d: d["turn_id"] == old) is not None)
    await asyncio.wait_for(enough_audio(), 60)
    out = {"old_turn_id": old, "audio_s_before_barge": round(call.audio_seconds(old), 2)}
    if call.find("reply_done", lambda d: d["turn_id"] == old) is not None:
        out["reply_finished_before_barge_ms_after_end"] = ms(call.t(call.find("reply_done")), t_end)
        await call.hangup()
        raise Failure(f"reply finished server-side before the barge-in ({out})")
    mark = len(call.events)
    t_barge = time.monotonic()
    speak = asyncio.create_task(call.speak(ctx["pcm"]))
    i_ack = await call.wait("reply_done", lambda d: d["turn_id"] == old, after=mark, timeout=30)
    ack = call.events[i_ack][2]
    out["interrupt_ack_ms_after_first_frame"] = ms(call.t(i_ack), t_barge)
    out["old_reply_done_interrupted"] = ack["interrupted"]
    late = [i for i in range(i_ack + 1, len(call.events))
            if call.events[i][1] == "audio" and call.events[i][2]["turn_id"] == old]
    await speak
    i_final2 = await call.wait("transcript_final", after=i_ack, timeout=60)
    i_done2 = await call.wait("reply_done", lambda d: d["turn_id"] != old, after=i_final2, timeout=90)
    late += [i for i in range(len(call.events))
             if i > i_ack and call.events[i][1] == "audio" and call.events[i][2]["turn_id"] == old and i not in late]
    new = call.events[i_done2][2]
    out.update(
        old_audio_frames_after_ack=len(late),
        second_final_word_match=round(word_match(SENTENCE, call.events[i_final2][2]["text"]), 2),
        new_turn_id=new["turn_id"], new_reply_interrupted=new["interrupted"],
        new_reply_audio_s=round(call.audio_seconds(new["turn_id"]), 2),
        errors=[d.get("code") for _, k, d in call.events if k == "error"],
    )
    out["close"] = await call.hangup()
    call.tally(ctx)
    msgs = await api.messages(conv)
    out["saved"] = [(m["role"], len(m["content"]), m["content"].endswith(" …")) for m in msgs]
    check(ack["interrupted"], "old reply_done not marked interrupted")
    check(not late, f"{len(late)} audio frames of the interrupted turn after the ack")
    check(ack["message_id"] is not None, "interrupted reply saved nothing (no sentence was fully sent)")
    check([m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"], f"saved roles {[m['role'] for m in msgs]}")
    check(msgs[1]["content"].endswith(" …") and msgs[1]["id"] == ack["message_id"], "interrupted reply not saved with ' …'")
    check(not new["interrupted"] and not msgs[3]["content"].endswith(" …"), "second reply incomplete")
    check(out["close"] == 1000, f"close {out['close']}")
    return out


async def _reply_started(api: Api, ctx: dict) -> tuple[Call, str]:
    conv = await api.conversation()
    call = await open_ready(api, conv, ctx, LONG_PROMPT)
    await call.speak(ctx["pcm"])
    i_final = await call.wait("transcript_final", timeout=60)
    await call.wait("audio", after=i_final, timeout=60)
    return call, conv


async def scenario_hangup(api: Api, ctx: dict) -> dict:
    out: dict = {}
    # 3a: hangup message mid-reply, then reconnect at once
    call, conv = await _reply_started(api, ctx)
    t = time.monotonic()
    out["hangup_close"] = await call.hangup()
    out["hangup_close_ms"] = ms(time.monotonic(), t)
    call.tally(ctx)
    out["hangup_reply_done_seen"] = call.find("reply_done") is not None
    again = await Call.open(api, await api.ticket(conv))
    await again.start(ctx["voice"], ctx["model"], SHORT_PROMPT)
    i = await again.wait("ready", timeout=20)  # a 4029 here fails with "closed with 4029"
    out["reconnect_after_hangup"] = f"ready (asr={again.events[i][2].get('asr')})"
    out["reconnect_close"] = await again.hangup()
    msgs = await api.messages(conv)
    out["hangup_saved"] = [(m["role"], len(m["content"]), m["content"].endswith(" …")) for m in msgs]
    check(out["hangup_close"] == 1000, f"hangup close {out['hangup_close']}")
    check(msgs and msgs[0]["role"] == "user", "user message of the hung-up turn not saved")
    check(all(not (m["role"] == "assistant" and not m["content"].endswith(" …")) for m in msgs),
          "a hung-up reply was saved as complete")

    # 3b: the client vanishes mid-reply (TCP drop, no close frame), then reconnect
    call, conv = await _reply_started(api, ctx)
    call.ws.transport.abort()
    call.tally(ctx)
    t = time.monotonic()
    attempts = 0
    while True:
        attempts += 1
        probe = await Call.open(api, await api.ticket(conv))
        await probe.start(ctx["voice"], ctx["model"], SHORT_PROMPT)
        try:
            await probe.wait("ready", timeout=20)
            break
        except Failure:
            # the server keeps the user's slot until session.drain() (pending assessments, ≤ 10 s) is done
            if probe.close_code != 4029 or time.monotonic() - t > 15:
                raise
            await asyncio.sleep(0.2)
    out["reconnect_after_drop_ms"] = ms(time.monotonic(), t)
    out["reconnect_after_drop_attempts"] = attempts
    out["reconnect_after_drop_close"] = await probe.hangup()
    msgs = await api.messages(conv)
    out["drop_saved"] = [(m["role"], len(m["content"]), m["content"].endswith(" …")) for m in msgs]
    return out


async def scenario_busy(api: Api, ctx: dict) -> dict:
    conv = await api.conversation()
    first_ticket = await api.ticket(conv)
    first = await Call.open(api, first_ticket)
    await first.start(ctx["voice"], ctx["model"], SHORT_PROMPT)
    await first.wait("ready", timeout=20)
    second = await expect_close(api, await api.ticket(conv), 4029)
    check(first.close_code is None, "the first call was affected by the second connection")
    close = await first.hangup()
    check(close == 1000, f"first call close {close}")
    ctx["used_ticket"] = first_ticket
    return {"second_close": second, "first_close": close}


async def scenario_tickets(api: Api, ctx: dict) -> dict:
    return {
        "bogus": await expect_close(api, "not-a-ticket", 4001),
        "missing": await expect_close(api, None, 4001),
        "reused": await expect_close(api, ctx["used_ticket"], 4001) if "used_ticket" in ctx else "skipped",
    }


HANGUP_CLOSE_MAX_MS = 3000  # the web client waits at most 3 s for the close frame after a hang-up
REPLY_EVENTS = ("reply_delta", "audio", "reply_done")


async def _assessment_linked(api: Api, conv: str, message_id: str, timeout: float = 15.0) -> bool:
    """After the call: is the assessment saved and linked to the user message (even if it missed the close frame)?"""
    end = time.monotonic() + timeout
    while True:
        msgs = await api.messages(conv)
        if any(m["id"] == message_id and m.get("assessment_id") for m in msgs):
            return True
        if time.monotonic() > end:
            return False
        await asyncio.sleep(0.5)


async def _hangup_pending(api: Api, ctx: dict, after_final: bool) -> dict:
    conv = await api.conversation()
    call = await open_ready(api, conv, ctx, SHORT_PROMPT)
    _, t_end = await call.speak(ctx["pcm"])
    if after_final:
        await call.wait("transcript_final", timeout=60)
    t_h = time.monotonic()
    await call.send_json({"type": "hangup"})
    i_closed = await call.wait("closed", timeout=20)
    t_close = call.t(i_closed)
    i_final = call.find("transcript_final")
    i_a = call.find("assessment")
    final = call.events[i_final][2] if i_final is not None else {}
    reply_after = [k for t, k, _ in call.events if k in REPLY_EVENTS and t >= t_h]
    out = {
        "hangup_ms_after_utterance_end": ms(t_h, t_end),
        "close": call.close_code,
        "close_ms_after_hangup": ms(t_close, t_h),
        "transcript_final_ms_after_hangup": ms(call.t(i_final), t_h),
        "word_match": round(word_match(SENTENCE, final["text"]), 2) if final else None,
        "assessment_before_close": i_a is not None and i_a < i_closed,
        "assessment_status": call.events[i_a][2].get("status") if i_a is not None else None,
        "assessment_ms_after_hangup": ms(call.t(i_a), t_h),
        "reply_events_after_hangup": reply_after,
        "reply_events_total": sum(1 for _, k, _ in call.events if k in REPLY_EVENTS),
        "errors": [d.get("code") for _, k, d in call.events if k == "error"],
    }
    call.tally(ctx)
    # informational: how long after the close frame the same user can start a new call (4029 until then)
    attempts = 0
    while True:
        attempts += 1
        probe = await Call.open(api, await api.ticket(conv))
        await probe.start(ctx["voice"], ctx["model"], SHORT_PROMPT)
        try:
            await probe.wait("ready", timeout=20)
            break
        except Failure:
            if probe.close_code != 4029 or time.monotonic() - t_close > 15:
                raise
            await asyncio.sleep(0.2)
    out["reconnect_ready_ms_after_close"] = ms(time.monotonic(), t_close)
    out["reconnect_attempts"] = attempts
    await probe.hangup()
    msgs = await api.messages(conv)
    out["saved"] = [(m["role"], len(m["content"]), m["content"].endswith(" …")) for m in msgs]
    if final.get("message_id") and ctx["expect_assessment"]:
        out["assessment_linked_after_call"] = await _assessment_linked(api, conv, final["message_id"])
    # checks last, so every measurement above is reported even when one fails
    failed = []
    for cond, message in (
        (out["close"] == 1000, f"close {out['close']}"),
        (out["close_ms_after_hangup"] <= HANGUP_CLOSE_MAX_MS, f"close frame {out['close_ms_after_hangup']} ms after hangup"),
        (bool(final.get("message_id")), "no transcript_final with a saved message before the close frame"),
        (bool(msgs) and msgs[0]["role"] == "user" and msgs[0]["id"] == final.get("message_id")
         and msgs[0]["content"] == final.get("text"), "the ended utterance was not saved as the user message"),
        (after_final or not reply_after, f"reply events after the hangup: {reply_after}"),
        (after_final or [m["role"] for m in msgs] == ["user"], f"saved roles {[m['role'] for m in msgs]}"),
        (not ctx["expect_assessment"] or out["assessment_before_close"], "assessment did not arrive before the close frame"),
        (not ctx["expect_assessment"] or out["assessment_status"] == "done", f"assessment {out['assessment_status']}"),
    ):
        if not cond:
            failed.append(message)
    check(not failed, "; ".join(failed) + f" — {json.dumps(out, ensure_ascii=False)}")
    return out


async def scenario_hangup_pending(api: Api, ctx: dict) -> dict:
    return await _hangup_pending(api, ctx, after_final=False)


async def scenario_hangup_after_final(api: Api, ctx: dict) -> dict:
    return await _hangup_pending(api, ctx, after_final=True)


def print_thinking() -> None:
    """In-process: does a realtime LLM request carry `thinking: disabled`? Prints booleans only."""
    from app.config import LLM_THINKING_HOST_SUFFIXES, Settings, host_matches, send_thinking_param
    settings = Settings()
    sends = send_thinking_param(settings.realtime_llm_disable_thinking, settings.upstream_llm_base_url,
                                LLM_THINKING_HOST_SUFFIXES)
    print(f"thinking: mode={settings.realtime_llm_disable_thinking} "
          f"upstream_is_deepseek={host_matches(settings.upstream_llm_base_url, ('deepseek.com',))} "
          f"sends_thinking_disabled={sends}")


def scan_log(path: Path, offset: int) -> dict:
    text = path.read_bytes()[offset:].decode("utf-8", "replace")
    lines = text.splitlines()
    bad = [ln for ln in lines if re.search(r"\b(ERROR|CRITICAL)\b|Traceback|realtime call failed", ln)]
    warn = [re.sub(r"^\S+ \S+ ", "", ln) for ln in lines if " WARNING " in ln]
    calls = [re.sub(r"^.*timing event=realtime_call ", "", ln) for ln in lines if "event=realtime_call" in ln]
    return {"error_lines": bad[:20], "warnings": warn[:20], "realtime_call": calls,
            "ticket_leaked": bool(re.search(r"ticket=(?!\[redacted\])[A-Za-z0-9_-]{8,}", text))}


async def main_async(args) -> int:
    api = Api(args.base_url)
    ctx: dict = {"expect_assessment": args.expect_assessment}
    log_offset = Path(args.server_log).stat().st_size if args.server_log else 0
    user = await api.register()
    print(f"user {user}")
    ctx["model"] = (await api.ok("GET", "/api/config/default_gpt_preset"))["configuration"]["model"]
    config = await api.ok("GET", "/api/realtime/config")
    print("realtime config", json.dumps(config))
    if not config.get("enabled"):
        print("FAIL realtime is not enabled on this server")
        return 1
    ctx["voice"] = args.voice
    cache = Path(args.pcm_cache) if args.pcm_cache else None
    if cache and cache.exists():
        ctx["pcm"] = cache.read_bytes()
        print(f"speech: cached {len(ctx['pcm']) / 32000:.2f} s")
    else:
        ctx["pcm"] = await api.speech_pcm(args.tts_model, args.voice)
        print(f"speech: generated by the server's TTS, {len(ctx['pcm']) / 32000:.2f} s")
        if cache:
            cache.write_bytes(ctx["pcm"])
    results: dict = {"config": config}
    failures = []
    for name, fn in (("1_turn", scenario_turn), ("2_barge_in", scenario_barge_in), ("3_hangup", scenario_hangup),
                     ("4_busy", scenario_busy), ("5_tickets", scenario_tickets),
                     ("6a_hangup_after_utterance_end", scenario_hangup_pending),
                     ("6b_hangup_after_final", scenario_hangup_after_final)):
        if args.only and name not in args.only.split(","):
            continue
        try:
            # a fresh user per scenario: a slot still held by the previous scenario's call (the server
            # releases it only after draining assessments) must not turn this scenario into a 4029
            await api.register()
            results[name] = await fn(api, ctx)
            print(f"PASS {name} {json.dumps(results[name], ensure_ascii=False)}")
        except Exception as e:  # noqa: BLE001
            failures.append(name)
            results[name] = {"failure": f"{type(e).__name__}: {e}"}
            print(f"FAIL {name} {type(e).__name__}: {e}")
    results["8_llm_first_delta_ms"] = ctx.get("llm_gaps", [])
    results["tts_sentences_estimate"] = ctx.get("tts_sentences", 0)
    print("8 llm: first reply_delta after transcript_final (ms)", results["8_llm_first_delta_ms"])
    print("in-call TTS sentences (estimate)", results["tts_sentences_estimate"])
    if args.server_log:
        await asyncio.sleep(1.0)  # let the last call's timing line reach the log
        results["server_log"] = scan_log(Path(args.server_log), log_offset)
        print("server log", json.dumps(results["server_log"], ensure_ascii=False))
        if results["server_log"]["error_lines"] or results["server_log"]["ticket_leaked"]:
            failures.append("server_log")
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    await api.http.aclose()
    print("RESULT", "FAIL " + ",".join(failures) if failures else "PASS")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base-url")
    parser.add_argument("--tts-model", default="volcengine/seed-tts-2.0")
    parser.add_argument("--voice", default="en_female_dacey_uranus_bigtts")
    parser.add_argument("--pcm-cache", help="16 kHz PCM16LE file of the test sentence (written on first run)")
    parser.add_argument("--expect-assessment", action="store_true", help="xfyun is configured: require an assessment")
    parser.add_argument("--server-log", help="the server's log file: scan the lines written during this run")
    parser.add_argument("--json-out")
    parser.add_argument("--only", help="comma-separated scenario names")
    parser.add_argument("--print-thinking", action="store_true",
                        help="only print (booleans) whether realtime LLM requests send thinking disabled; "
                             "reads Settings() from the .env in the cwd (needs the server dir on PYTHONPATH)")
    args = parser.parse_args()
    if args.print_thinking:
        print_thinking()
        return 0
    if not args.base_url:
        parser.error("--base-url is required")
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
