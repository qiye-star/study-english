"""自由说话评测与语法检查的实测(计划 Task 5.2,设计文档 §5)。

用服务端现有 TTS 合成三组英文(A 故意的语法错误 / B 正确句 / C "读错"变体:把目标词换成近音真实词),
外加仓库里的真人录音 jfk.wav,逐条走与语音消息相同的路径:
转写(不带语言提示)→ 以转写为参考的发音评测 → 语法检查;C 组再以本意句为参考评测一次(相当于跟读页)。

Usage(服务需已运行;密钥只在 server/.env;需要本机 ffmpeg):
  uv run python scripts/eval_free_speech.py --base-url http://127.0.0.1:8765 --json ../.superpowers/eval/free-speech.json
标准输出是 Markdown(汇总 + 明细),原样贴进记录文档。只打印状态码,不打印上游响应体。
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
CASES_FILE = HERE / "eval_free_speech_cases.json"
JFK_WAV = HERE.parent.parent / "enjoy" / "samples" / "jfk.wav"
CACHE_DIR = HERE.parent.parent / ".superpowers" / "eval" / "tts-cache"  # cached WAVs, resumable (git-ignored)
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
BLOCKED_STATUSES = {403, 502, 503}
JFK_TEXT = "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country."
TTS_MODEL = "volcengine/seed-tts-2.0"
DEFAULT_VOICES = "en_male_tim_uranus_bigtts,en_female_dacey_uranus_bigtts"
FILLERS = {"uh", "um", "er", "erm", "ah", "hmm", "mm", "uhm"}
POOR_ACCURACY = 60
RETAINED_THRESHOLD = 0.7
FALSE_POSITIVE_THRESHOLD = 0.1


def words(text: str) -> list[str]:
    found = re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))
    return [w for w in found if w not in FILLERS]


def norm(text: str) -> str:
    return " ".join(words(text))


def contains_phrase(text: str, phrase: str) -> bool:
    return f" {norm(phrase)} " in f" {norm(text)} "


def poor_words(assessment: dict) -> list[str]:
    """与网页端 isPoorWord 相同的规则:Mispronunciation/Omission,或准确度 < 60;多说的词(Insertion)不算。"""
    out = []
    for w in (assessment.get("detail_result") or {}).get("words") or []:
        pa = w.get("pronunciation_assessment") or {}
        kind = pa.get("error_type")
        score = pa.get("accuracy_score")
        if kind == "Insertion":
            continue
        if kind in ("Mispronunciation", "Omission") or (isinstance(score, (int, float)) and score < POOR_ACCURACY):
            out.append(str(w.get("word", "")).lower())
    return out


def grammar_hits(grammar: dict, marker: str) -> bool:
    marker_words = set(words(marker))
    return bool(grammar.get("has_errors")) and any(marker_words & set(words(e.get("original", ""))) for e in grammar.get("errors") or [])


def _rate(rows: list[dict], key: str) -> float:
    return sum(1 for r in rows if r.get(key)) / len(rows) if rows else 0.0


def summarize(rows: list[dict]) -> dict:
    rows = [r for r in rows if not r.get("error")]  # incomplete rows (e.g. empty transcript) don't count
    a = [r for r in rows if r["group"] == "A"]
    b = [r for r in rows if r["group"] == "B"]
    c = [r for r in rows if r["group"] == "C"]
    retained = [r for r in a if r.get("retained")]
    return {
        "a_total": len(a),
        "a_retained_rate": _rate(a, "retained"),
        "a_detected_rate_when_retained": _rate(retained, "grammar_hit"),
        "a_detected_rate_overall": _rate(a, "grammar_hit"),
        "b_total": len(b),
        "b_false_positive_rate": _rate(b, "false_positive"),
        "c_total": len(c),
        "c_transcribed_as_spoken": _rate(c, "transcribed_as_spoken"),
        "c_transcribed_as_intended": _rate(c, "transcribed_as_intended"),
        "c_flagged_vs_transcript": _rate(c, "flagged_vs_transcript"),
        "c_flagged_vs_intended": _rate(c, "flagged_vs_intended"),
        "fallback_needed": bool(a) and _rate(a, "retained") < RETAINED_THRESHOLD,
        "prompt_review_needed": bool(b) and _rate(b, "false_positive") > FALSE_POSITIVE_THRESHOLD,
    }


def to_wav(audio: bytes, suffix: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / f"in{suffix}", Path(tmp) / "out.wav"
        src.write_bytes(audio)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(dst)], check=True)
        return dst.read_bytes()


class BlockedError(RuntimeError):
    """Upstream unavailable (403/502/503): the evaluation cannot run; no results are written."""


_SAFE_MESSAGE = re.compile(r"[A-Za-z0-9 .,:;_'()/-]{1,120}")


def _safe_error_code(r: httpx.Response) -> str:
    """Short server-authored message for the BLOCKED line.

    The server shapes errors as {"error": "<message>"} (app/core/errors.py); `detail` is accepted as a fallback.
    Only a short string made of printable ASCII and basic punctuation is shown (capped at 120 chars);
    dicts, lists, long or odd strings are never echoed. Falls back to a short code/type, then 'unknown'.
    """
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return "unknown"
    if not isinstance(body, dict):
        return "unknown"
    for key in ("error", "detail"):
        v = body.get(key)
        if isinstance(v, str) and _SAFE_MESSAGE.fullmatch(v.strip()):
            return v.strip()
    for key in ("code", "type"):
        v = body.get(key)
        if isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", v):
            return v
    return "unknown"


class Server:
    def __init__(self, base_url: str):
        self.http = httpx.Client(base_url=base_url, timeout=300)
        self.headers: dict[str, str] = {}

    def _checked(self, r: httpx.Response) -> httpx.Response:
        if r.status_code in BLOCKED_STATUSES:
            raise BlockedError(f"BLOCKED: {r.request.url.path} {r.status_code} {_safe_error_code(r)}")
        if r.status_code >= 400:
            raise RuntimeError(f"{r.request.method} {r.request.url.path} -> {r.status_code}")  # 不打印响应体
        return r

    def _post(self, path: str, **kwargs) -> httpx.Response:
        for _ in range(5):
            r = self.http.post(path, headers=self.headers, **kwargs)
            if r.status_code != 429:
                return self._checked(r)
            time.sleep(15)  # 用户级限流:等下一个窗口
        return self._checked(r)

    def register(self) -> None:
        r = self._checked(self.http.post("/api/users", json={"username": "eval_" + secrets.token_hex(4), "password": secrets.token_hex(8)}))
        try:
            self.headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        except (KeyError, ValueError, TypeError) as exc:
            raise RuntimeError("unexpected response from /api/users (no access_token)") from exc

    def tts(self, text: str, voice: str) -> bytes:
        return self._post("/api/ai/audio/speech", json={"input": text, "model": TTS_MODEL, "voice": voice}).content

    def transcribe(self, wav: bytes) -> str:
        r = self._post("/api/ai/audio/transcriptions", files={"file": ("a.wav", wav, "audio/wav")},
                       data={"model": "whisper-1", "response_format": "json"})
        return str(r.json().get("text", "")).strip()

    def assess(self, wav: bytes, reference: str) -> dict:
        return self._post("/api/speech/assessments", files={"file": ("a.wav", wav, "audio/wav")},
                          data={"reference": reference, "language": "en-US"}).json()

    def grammar(self, text: str) -> dict:
        return self._post("/api/ai/grammar", json={"text": text}).json()


def cached_wav(server: Server, text: str, voice: str) -> bytes:
    """Synthesize to 16k mono WAV, cached by (voice, text) so reruns spend no TTS calls."""
    path = CACHE_DIR / (hashlib.sha1(f"{TTS_MODEL}|{voice}|{text}".encode()).hexdigest() + ".wav")
    if path.exists():
        return path.read_bytes()
    wav = to_wav(server.tts(text, voice), ".mp3")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(wav)
    os.replace(tmp, path)  # atomic: an interrupted run never leaves a half-written WAV
    return wav


def run_case(server: Server, group: str, case: dict, voice: str, wav: bytes) -> dict:
    transcript = server.transcribe(wav)
    row = {"group": group, "id": case["id"], "voice": voice, "spoken": case.get("spoken", ""), "transcript": transcript}
    if not transcript:
        return {**row, "error": "empty transcript"}
    vs_transcript = server.assess(wav, transcript)
    grammar = server.grammar(transcript) if len(words(transcript)) >= 3 else {"has_errors": False, "errors": []}
    row.update({
        "score": vs_transcript.get("pronunciation_score"),
        "poor": poor_words(vs_transcript),
        "grammar": [f"{e['original']} -> {e['corrected']}" for e in grammar.get("errors") or []],
    })
    if group == "A":
        row.update({"retained": contains_phrase(transcript, case["marker"]), "grammar_hit": grammar_hits(grammar, case["marker"])})
    elif group == "B":
        row["false_positive"] = bool(grammar.get("has_errors"))
    elif group == "C":
        said = set(words(transcript))
        vs_intended = server.assess(wav, case["intended"])
        row.update({
            "transcribed_as_spoken": case["substitute"] in said,
            "transcribed_as_intended": case["target"] in said,
            "flagged_vs_transcript": bool({case["substitute"], case["target"]} & set(row["poor"])),
            "flagged_vs_intended": case["target"] in poor_words(vs_intended),
            "score_vs_intended": vs_intended.get("pronunciation_score"),
        })
    return row


def render_markdown(rows: list[dict], summary: dict) -> str:
    pct = lambda v: f"{v * 100:.0f}%"  # noqa: E731
    lines = [
        "| 指标 | 值 |", "|---|---|",
        f"| A 组(语法错误)转写保留错误的比例 | {pct(summary['a_retained_rate'])}(阈值 {pct(RETAINED_THRESHOLD)}) |",
        f"| A 组语法模型指出该错误(全部 / 仅保留了错误的) | {pct(summary['a_detected_rate_overall'])} / {pct(summary['a_detected_rate_when_retained'])} |",
        f"| B 组(正确句)误报率 | {pct(summary['b_false_positive_rate'])}(阈值 {pct(FALSE_POSITIVE_THRESHOLD)}) |",
        f"| C 组转写成「说出来的词」/ 改成「本意词」 | {pct(summary['c_transcribed_as_spoken'])} / {pct(summary['c_transcribed_as_intended'])} |",
        f"| C 组目标词被标为读差(以转写为参考 / 以本意句为参考) | {pct(summary['c_flagged_vs_transcript'])} / {pct(summary['c_flagged_vs_intended'])} |",
        f"| 决定:需要降级(语法只对文字输入) | {'是' if summary['fallback_needed'] else '否'} |",
        f"| 决定:需要复查内置规则(误报) | {'是' if summary['prompt_review_needed'] else '否'} |",
        "", "| 组 | id | 音色 | 说的是 | 转写 | 判定 | 语法结果 | 发音分 | 读差的词 |", "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        verdict = {
            "A": f"保留错误={'是' if r.get('retained') else '否'};指出={'是' if r.get('grammar_hit') else '否'}",
            "B": f"误报={'是' if r.get('false_positive') else '否'}",
            "C": f"转写为说出的词={'是' if r.get('transcribed_as_spoken') else '否'};标出(转写/本意)="
                 f"{'是' if r.get('flagged_vs_transcript') else '否'}/{'是' if r.get('flagged_vs_intended') else '否'}",
            "R": "真人录音",
        }[r["group"]]
        lines.append(f"| {r['group']} | {r['id']} | {r['voice']} | {r['spoken']} | {r['transcript']} | {r.get('error') or verdict} | "
                     f"{'; '.join(r.get('grammar') or []) or '—'} | {r.get('score', '—')} | {', '.join(r.get('poor') or []) or '—'} |")
    return "\n".join(lines)


def recommendations(summary: dict) -> list[str]:
    """Advice per the R22 thresholds (the human still writes the decision into the record doc)."""
    out = []
    if summary.get("fallback_needed"):
        out.append("A 组转写保留错误的比例低于阈值:执行 Task 5.3,把 web/src/features/chat/turn-results.ts 的 GRAMMAR_FOR_VOICE 改为 false(语法只对文字输入)。")
    else:
        out.append("A 组转写保留错误的比例达标:不降级,GRAMMAR_FOR_VOICE 保持 true。")
    if summary.get("prompt_review_needed"):
        out.append("B 组误报率超过阈值:逐条查看被误报的正确句,在 server/app/services/grammar.py 的 DEFAULT_GRAMMAR_RULES 里加/改一条针对性规则并重跑(不动 GRAMMAR_OUTPUT_CONTRACT)。")
    else:
        out.append("B 组误报率达标:内置规则不用改。")
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    parser.add_argument("--voices", default=DEFAULT_VOICES)
    parser.add_argument("--json", help="write raw rows and summary to this path")
    parser.add_argument("--allow-remote", action="store_true", help="allow a non-loopback --base-url (the script registers a user there)")
    args = parser.parse_args()
    if not args.allow_remote and urlparse(args.base_url).hostname not in LOOPBACK_HOSTS:
        print("refusing a non-loopback --base-url (the script registers a user); pass --allow-remote to override", file=sys.stderr)
        return 2
    if shutil.which("ffmpeg") is None:
        print("ffmpeg not found on PATH; install it first", file=sys.stderr)
        return 2
    try:
        return evaluate(args)
    except BlockedError as exc:
        print(str(exc), file=sys.stderr)
        print("Evaluation incomplete; no results written.", file=sys.stderr)
        return 3
    except (httpx.HTTPError, RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


def evaluate(args: argparse.Namespace) -> int:
    cases = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    server = Server(args.base_url)
    server.register()
    rows: list[dict] = []
    groups = (("A", "grammar_errors"), ("B", "correct"), ("C", "mispronounced"))
    for voice in [v.strip() for v in args.voices.split(",") if v.strip()]:
        for group, key in groups:
            for case in cases[key]:
                wav = cached_wav(server, case["spoken"], voice)
                rows.append(run_case(server, group, case, voice, wav))
                print(f"done {group} {case['id']} {voice}", file=sys.stderr)
    rows.append(run_case(server, "R", {"id": "R1", "spoken": JFK_TEXT}, "jfk.wav(真人)", JFK_WAV.read_bytes()))
    summary = summarize(rows)
    print(render_markdown(rows, summary))
    print("\n建议(R22):\n" + "\n".join(f"- {line}" for line in recommendations(summary)))
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
