"""智能体回合的服务端开销测量(假上游;spec 2026-10-12-agents §6、计划 Z2)。不访问任何真实厂商。

在进程内建应用(临时 SQLite 文件库)、把 app.state.http 换成 httpx.MockTransport 假上游(首字延迟 / 块间隔可配)、
造一个有学习数据的用户(词条、近 7 天学新词事件、易错词),经 ASGI 调 POST /api/agents/turn,从 `app.timing` 的
`event=agent_turn` 行读 ctx_ms / ttft_ms / total_ms,输出 Markdown(中位数、p90、最大)。
这些数字只说明「本机 + 假上游」下服务端自己的开销;真实上游的首字时间不在这里(计划 Z3)。

用法(server/ 下):
  uv run python scripts/agents_latency.py --turns 30 --first-token-ms 400 --chunk-ms 30 --chunks 12
  uv run python scripts/agents_latency.py --turns 30 --wordbook   # 同时打开查词(读仓库词典;预热回合建索引,不计入)
"""
import argparse
import asyncio
import json
import logging
import platform
import re
import sqlite3
import sys
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.orchestrator import runtime  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.db import Base  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import LinkMistakeWord, VocabularyItem, WordbookEnrollment, WordbookEvent, utcnow  # noqa: E402

LINE = re.compile(r"event=agent_turn (.*)")
TEXT = "Yesterday I had to abandon my bicycle and walk home because the chain broke"


class Collector(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.rows: list[dict[str, str]] = []

    def emit(self, record: logging.LogRecord) -> None:
        match = LINE.search(record.getMessage())
        if match:
            self.rows.append(dict(kv.split("=", 1) for kv in match.group(1).split()))


def fake_upstream(first_ms: int, chunk_ms: int, chunks: int) -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        if not json.loads(request.content).get("stream"):  # background memory extraction: an empty op list
            message = {"role": "assistant", "content": '{"ops": []}'}
            return httpx.Response(200, json={"choices": [{"index": 0, "message": message}],
                                             "usage": {"prompt_tokens": 50, "completion_tokens": 5}})

        async def body():
            await asyncio.sleep(first_ms / 1000)
            for i in range(chunks):
                if i:
                    await asyncio.sleep(chunk_ms / 1000)
                chunk = {"choices": [{"index": 0, "delta": {"content": f"word{i} "}}]}
                yield f"data: {json.dumps(chunk)}\n\n".encode()
            usage = {"choices": [], "usage": {"prompt_tokens": 500, "completion_tokens": chunks}}
            yield f"data: {json.dumps(usage)}\n\n".encode()
            yield b"data: [DONE]\n\n"
        return httpx.Response(200, content=body(), headers={"content-type": "text/event-stream"})
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def seed(app, user_id: int, wordbook: bool) -> None:
    now = utcnow()
    async with app.state.sessionmaker() as s:
        for i in range(200):
            s.add(VocabularyItem(user_id=user_id, word=f"vocab{i}", source="manual",
                                 due_at=now - timedelta(hours=1) if i % 2 else now + timedelta(days=3)))
        for i in range(300):
            s.add(WordbookEvent(user_id=user_id, book_id="junior", kind="learn", word=f"learn{i % 80}", outcome="ok",
                                day=now.date().isoformat(), created_at=now - timedelta(minutes=i * 20)))
        for i in range(20):
            s.add(LinkMistakeWord(user_id=user_id, word=f"miss{i}", book_id="junior", wrong_count=i + 1, ok_streak=0,
                                  last_event_at=now, last_wrong_at=now))
        if wordbook:
            s.add(WordbookEnrollment(user_id=user_id, book_id="junior", status="active", order_mode="book", seed=1,
                                     cursor=0, daily_new=20, review_cap=100))
        await s.commit()


def pick(values: list[int], q: float) -> int:
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, round(q * (len(ordered) - 1))))]


def row(label: str, values: list[int]) -> str:
    return f"| {label} | {pick(values, 0.5)} | {pick(values, 0.9)} | {max(values)} |"


async def main(args: argparse.Namespace) -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # the Markdown is Chinese; a Windows console defaults to GBK
    tmp = Path(tempfile.mkdtemp(prefix="agents-latency-"))
    settings = Settings(_env_file=None, database_url=f"sqlite+aiosqlite:///{(tmp / 'bench.db').as_posix()}",
                        data_dir=str(tmp), upstream_llm_base_url="https://llm.fake/v1", upstream_llm_key="fake",
                        agents_enabled=True, rate_limit_per_minute=10000, ai_rate_limit_per_minute=10000,
                        wordbook_enabled=args.wordbook, log_level="WARNING")
    app = create_app(settings)
    async with app.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await app.state.http.aclose()
    app.state.http = fake_upstream(args.first_token_ms, args.chunk_ms, args.chunks)
    collector = Collector()
    timing = logging.getLogger("app.timing")
    timing.addHandler(collector)
    timing.setLevel(logging.INFO)
    timing.propagate = False  # the collector reads the lines; stdout stays the Markdown report only
    history = [{"role": "user" if i % 2 else "assistant", "content": f"history message number {i}. " * 6}
               for i in range(20)]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://bench") as client:
        token = (await client.post("/api/users", json={"username": "bench", "password": "password123"})).json()
        headers = {"Authorization": f"Bearer {token['access_token']}"}
        user_id = int((await client.get("/api/me", headers=headers)).json()["id"])
        await seed(app, user_id, args.wordbook)
        conv = (await client.post("/api/conversations", headers=headers, json={"name": "bench"})).json()["id"]
        for _ in range(args.warmup + args.turns):
            body = {"persona_id": "builtin:partner", "conversation_id": conv, "text": TEXT, "history": history,
                    "mode": "chat", "client_turn_id": str(uuid.uuid4())}
            r = await client.post("/api/agents/turn", headers=headers, json=body)
            if r.status_code != 200 or "event: done" not in r.text:
                raise SystemExit(f"turn failed: HTTP {r.status_code}")
            # background memory jobs finish before the next turn, so one turn's extraction never skews the next
            await asyncio.gather(*list(runtime(app).tasks), return_exceptions=True)
            await app.state.agent_memory.worker.join()
    await app.state.http.aclose()
    await app.state.engine.dispose()
    rows = collector.rows[args.warmup:]
    ctx = [int(r["ctx_ms"]) for r in rows]
    ttft = [int(r["ttft_ms"]) for r in rows]
    total = [int(r["total_ms"]) for r in rows]
    print(f"- 环境:Python {platform.python_version()} · {platform.system()} {platform.release()} · "
          f"SQLite {sqlite3.sqlite_version} · 假上游(httpx.MockTransport)")
    print(f"- 参数:turns={args.turns} warmup={args.warmup} first_token_ms={args.first_token_ms} "
          f"chunk_ms={args.chunk_ms} chunks={args.chunks} wordbook={args.wordbook} history=20 条")
    print(f"- 来源:每回合 {rows[0]['src_count']} 个;跳过合计 {sum(int(r['src_skipped']) for r in rows)},"
          f"失败合计 {sum(int(r['src_failed']) for r in rows)}")
    print()
    print("| 指标(毫秒) | 中位数 | p90 | 最大 |")
    print("|---|---|---|---|")
    print(row("ctx_ms(并行预取)", ctx))
    print(row("ttft_ms(请求进入编排 → 第一个可见字)", ttft))
    print(row("ttft_ms − 假上游首字延迟(服务端开销估计)", [t - args.first_token_ms for t in ttft]))
    print(row("total_ms", total))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--turns", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--first-token-ms", type=int, default=400)
    parser.add_argument("--chunk-ms", type=int, default=30)
    parser.add_argument("--chunks", type=int, default=12)
    parser.add_argument("--wordbook", action="store_true")
    asyncio.run(main(parser.parse_args()))
