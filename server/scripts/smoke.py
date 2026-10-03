"""对运行中的服务做真实上游冒烟测试。

Usage: uv run python scripts/smoke.py --base-url http://localhost:8000
会注册一个随机用户。未配置的能力(503)显示为 SKIP。
可选:--wav PATH --reference TEXT [--language en-US] 额外检查发音评测(讯飞)。
"""
import argparse
import json
import secrets
import sys

import httpx


class Skip(Exception):
    pass


def require_ok(r: httpx.Response) -> httpx.Response:
    if r.status_code == 503:
        raise Skip(r.json().get("error", "not configured"))
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text[:200]}")
    return r


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--wav", help="16 kHz mono 16-bit WAV for the pronunciation assessment check")
    parser.add_argument("--reference", help="reference text for --wav")
    parser.add_argument("--language", default="en-US")
    args = parser.parse_args()
    if bool(args.wav) != bool(args.reference):
        parser.error("--wav and --reference must be given together")

    http = httpx.Client(base_url=args.base_url, timeout=120)
    failures: list[str] = []
    state: dict = {}

    def check(name, fn):
        try:
            detail = fn()
            print(f"PASS  {name}  {detail or ''}")
        except Skip as exc:
            print(f"SKIP  {name}  ({exc})")
        except Exception as exc:  # noqa: BLE001
            failures.append(name)
            print(f"FAIL  {name}  {exc}")

    def register():
        name = "smoke_" + secrets.token_hex(4)
        r = require_ok(http.post("/api/users", json={"username": name, "password": "password123"}))
        body = r.json()
        assert len(body["id"]) == 8 and body["id"].isdigit(), body
        state["headers"] = {"Authorization": f"Bearer {body['access_token']}"}
        state["model"] = require_ok(http.get("/api/config/default_gpt_preset")).json()["configuration"]["model"]
        return f"user={name} model={state['model']}"

    def chat():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "max_tokens": 16,
            "messages": [{"role": "user", "content": "Say OK"}],
        }))
        return r.json()["choices"][0]["message"]["content"][:40]

    def chat_stream():
        chunks = 0
        done = False
        with http.stream("POST", "/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "stream": True,
            "messages": [{"role": "user", "content": "Count to 3"}],
        }) as r:
            if r.status_code == 503:
                raise Skip("LLM not configured")
            assert r.status_code == 200, r.read()
            for line in r.iter_lines():
                if line.startswith("data:"):
                    chunks += 1
                    done = done or "[DONE]" in line
        assert chunks > 1 and done, f"chunks={chunks} done={done}"
        return f"{chunks} chunks"

    def chat_json_mode():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": 'Reply with the JSON {"ok": true}'}],
        }))
        json.loads(r.json()["choices"][0]["message"]["content"])

    def chat_tool_call():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"],
            "messages": [{"role": "user", "content": "answer: 42"}],
            "tools": [{"type": "function", "function": {"name": "emit", "parameters": {
                "type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}}}],
            "tool_choice": {"type": "function", "function": {"name": "emit"}},
        }))
        assert r.json()["choices"][0]["message"].get("tool_calls"), "no tool_calls in response"

    def tts_openai():
        r = require_ok(http.post("/api/ai/audio/speech", headers=state["headers"], json={
            "model": "openai/tts-1", "voice": "alloy", "input": "Hello world"}))
        assert len(r.content) > 1000
        state["mp3"] = r.content
        return f"{len(r.content)} bytes"

    def tts_azure():
        r = require_ok(http.post("/api/ai/audio/speech", headers=state["headers"], json={
            "model": "azure/speech", "voice": "en-US-AvaNeural", "input": "Hello world"}))
        assert len(r.content) > 1000
        state["mp3"] = r.content
        return f"{len(r.content)} bytes"

    def whisper():
        if "mp3" not in state:
            raise Skip("no audio produced by the TTS checks")
        r = require_ok(http.post("/api/ai/audio/transcriptions", headers=state["headers"],
            files={"file": ("audio.mp3", state["mp3"], "audio/mpeg")},
            data={"model": "whisper-1", "response_format": "verbose_json"}))
        text = r.json()["text"].lower()
        assert "hello" in text, text
        return text.strip()

    def speech_token():
        r = require_ok(http.post("/api/speech/tokens", headers=state["headers"], json={"purpose": "transcribe"}))
        body = r.json()
        assert isinstance(body["id"], int) and body["token"].count(".") == 2 and body["region"], body
        require_ok(http.put(f"/api/speech/tokens/{body['id']}", headers=state["headers"], json={"state": "consumed"}))
        return f"region={body['region']}"

    def assessment():
        with open(args.wav, "rb") as f:
            wav = f.read()
        r = require_ok(http.post("/api/speech/assessments", headers=state["headers"],
            files={"file": ("audio.wav", wav, "audio/wav")},
            data={"reference": args.reference, "language": args.language}))
        body = r.json()
        assert "pronunciation_score" in body, body
        words = body.get("detail_result", {}).get("words", [])
        return f"score={body['pronunciation_score']} words={len(words)}"

    checks = [
        ("register", register),
        ("chat", chat),
        ("chat stream", chat_stream),
        ("chat json mode", chat_json_mode),
        ("chat tool call", chat_tool_call),
        ("tts openai/tts-1", tts_openai),
        ("tts azure/speech", tts_azure),
        ("whisper (tts -> stt round trip)", whisper),
        ("speech token", speech_token),
    ]
    if args.wav:
        checks.append(("pronunciation assessment (xfyun)", assessment))

    for name, fn in checks:
        check(name, fn)
        if name == "register" and "register" in failures:
            break

    print("\nFAILED: " + ", ".join(failures) if failures else "\nAll checks passed (SKIP = not configured).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
