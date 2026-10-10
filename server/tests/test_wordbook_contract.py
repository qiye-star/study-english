"""背单词端点契约(计划 P-W5)。网页 web/src/features/wordbook 的契约测试读取同一个文件逐键核对。

重新录制:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_wordbook_contract.py`
(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE`)。"""
import json
import os
import random
from datetime import timedelta
from pathlib import Path

from sqlalchemy import update

from app.models import VocabularyItem, utcnow
from tests.test_web_contract import shape
from tests.wordbook_helpers import enable_wordbook, make_data_dir

FIXTURE = Path(__file__).parent / "fixtures" / "wordbook_contract.json"
URL = "/api/wordbook"
KEYS = {"config", "books", "enrollment", "today", "learn_batch", "answer_choice", "answer_typed", "review_batch",
        "spell_sets", "spell_submit", "card", "explain_unavailable"}


async def collect(app, client, tmp_path) -> dict:
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_books="junior")
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    out = {"config": (await client.get(f"{URL}/config", headers=h)).json()}
    out["enrollment"] = (await client.put(f"{URL}/enrollment", headers=h,
                                          json={"book_id": "junior", "order_mode": "book"})).json()
    out["books"] = (await client.get(f"{URL}/books", headers=h)).json()
    out["learn_batch"] = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 5})).json()
    choice = out["learn_batch"]["quiz"][0]["options"][0]
    out["answer_choice"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "talk", "mode": "learn", "qtype": "meaning", "choice": choice})).json()
    for key in ("ability", "able", "abandon", "absorb"):
        await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                            "qtype": "meaning", "known": True})
    async with app.state.sessionmaker() as s:  # 只让 talk(盒 0)到期:题型只会是选择题
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    out["today"] = (await client.get(f"{URL}/today", headers=h)).json()
    out["review_batch"] = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 3})).json()
    for q in out["review_batch"]["questions"]:  # 题面字段随题型变(种子含随机的用户 id),契约只核对外层形状
        q["prompt"] = {}
    out["answer_typed"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "talk", "mode": "review", "qtype": "spell", "typed": "talkk"})).json()
    out["spell_sets"] = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 3})).json()
    s0 = out["spell_sets"]["sets"][0]
    out["spell_submit"] = (await client.post(f"{URL}/spell/submit", headers=h, json={
        "book_id": "junior", "set_id": s0["set_id"],
        "lines": [{"key": l["key"], "sentence_id": l["sentence_id"], "answers": [{"typed": "x", "hinted": False}]}
                  for l in s0["lines"]]})).json()
    out["card"] = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()
    out["explain_unavailable"] = (await client.post(f"{URL}/explain", headers=h, json={"key": "talk"})).json()
    return out


async def test_wordbook_payloads_match_the_web_contract(app, client, tmp_path, monkeypatch):
    real = random.Random
    monkeypatch.setattr(random, "Random", lambda seed=0: real(seed))  # 句组抽词固定,样例稳定
    actual = await collect(app, client, tmp_path)
    assert set(actual) == KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
                           newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    # 录制的样例里不能有令牌、密钥或本机路径
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw and str(tmp_path.anchor) not in raw.replace("\\\\", "\\")
    # 列表非空(shape 只看第一个元素)、契约里没有以词为键的映射
    for path in (("learn_batch", "cards"), ("learn_batch", "quiz"), ("review_batch", "questions"),
                 ("review_batch", "cards"), ("spell_sets", "sets"), ("spell_submit", "words"), ("books", "books")):
        assert isinstance(expected[path[0]][path[1]], list) and expected[path[0]][path[1]], path
    assert expected["explain_unavailable"] == {"error": "AI explanation unavailable"}
