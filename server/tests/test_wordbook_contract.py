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
from app.wordbook import service
from tests.test_web_contract import shape
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

FIXTURE = Path(__file__).parent / "fixtures" / "wordbook_contract.json"
URL = "/api/wordbook"
KEYS = {"config", "books", "enrollment", "today", "learn_batch", "answer_choice", "answer_typed", "review_batch",
        "spell_sets", "spell_submit", "card", "explain_unavailable", "answer_recall", "answer_check"}
GOALS_KEYS = {"enrollment_patch", "bonus", "pause", "today_paused", "resume", "reset"}  # 计划 2026-10-11 GS5
DEFS_KEYS = {"def_lang_patch"}  # 计划 2026-10-12-wordbook-definitions-server P1
LEARNED_KEYS = {"learned_summary", "learned_list", "learned_card", "free_start", "answer_free"}  # 计划 2026-10-12-wordbook-learned-review S6


async def collect(app, client, tmp_path, monkeypatch) -> dict:
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_books="junior")
    make_defs_dir(tmp_path)  # 英文释义(spec 2026-10-12-wordbook-definitions):词卡带可选的 defs_en
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
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "able")  # 刚学的词不能被自由答错拉到今天到期(R-L6)
                        .values(created_at=utcnow() - timedelta(days=2)))
        await s.commit()
    out["today"] = (await client.get(f"{URL}/today", headers=h)).json()
    out["review_batch"] = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 3})).json()
    for q in out["review_batch"]["questions"]:  # 题面字段随题型变(种子含随机的用户 id),契约只核对外层形状
        q["prompt"] = {}
    out["answer_typed"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "ability", "mode": "review", "qtype": "spell", "typed": "abilityy"})).json()  # 未到期:题型不受限(review m2)
    out["spell_sets"] = (await client.post(f"{URL}/spell/sets", headers=h, json={"count": 1, "size": 3})).json()
    s0 = out["spell_sets"]["sets"][0]
    out["spell_submit"] = (await client.post(f"{URL}/spell/submit", headers=h, json={
        "book_id": "junior", "set_id": s0["set_id"],
        "lines": [{"key": l["key"], "sentence_id": l["sentence_id"], "answers": [{"typed": "x", "hinted": False}]}
                  for l in s0["lines"]]})).json()
    # 背单词 v2(spec 2026-10-11-wordbook-recall §9):学新词自评;复习快速回忆的抽查待答(pending + check)
    out["answer_recall"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "accept", "mode": "learn", "qtype": "recall", "rating": "fuzzy",
        "revealed_before": False, "elapsed_ms": 2400})).json()
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: True)
    app.state.settings = app.state.settings.model_copy(update={"wordbook_spot_check_pct": 100})
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "ability")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    out["answer_check"] = (await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": "ability", "mode": "review", "qtype": "recall", "rating": "know"})).json()
    out["card"] = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()
    out["explain_unavailable"] = (await client.post(f"{URL}/explain", headers=h, json={"key": "talk"})).json()
    out |= await collect_learned(client, h)
    out |= await collect_goals(client, h)
    return out


async def collect_learned(client, h) -> dict:
    """已学词与自由复习(计划 2026-10-12-wordbook-learned-review S6):接在 collect() 之后(已学 6 个词)、重置之前。"""
    async def ok(r):
        assert r.status_code == 200, r.text
        return r.json()
    out = {"learned_summary": await ok(await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": 0}))}
    out["learned_list"] = await ok(await client.post(f"{URL}/learned/query", headers=h, json={"limit": 2}))  # limit 2 → next_cursor 是字符串
    out["learned_card"] = await ok(await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"}))
    out["free_start"] = await ok(await client.post(f"{URL}/free/start", headers=h, json={"scope": "all", "mode": "choice", "count": 10}))
    out["answer_free"] = await ok(await client.post(f"{URL}/answers", headers=h, json={  # able 盒 2、未到期:答错 → 入队
        "book_id": "junior", "key": "able", "mode": "free", "qtype": "word", "choice": "stop"}))
    return out


async def collect_goals(client, h) -> dict:
    """goals v2(spec 2026-10-11 §9):接在 collect() 的流程之后(今天已学 6 个);重置会删词书行,所以放最后。"""
    async def ok(r):
        assert r.status_code == 200, r.text
        return r.json()
    out = {"enrollment_patch": await ok(await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 5}))}
    out["def_lang_patch"] = await ok(await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"}))
    out["bonus"] = await ok(await client.post(f"{URL}/bonus", headers=h, json={"size": 5}))
    out["pause"] = await ok(await client.post(f"{URL}/enrollment/pause", headers=h, json={}))
    out["today_paused"] = await ok(await client.get(f"{URL}/today", headers=h))
    out["resume"] = await ok(await client.post(f"{URL}/enrollment/resume", headers=h, json={"book_id": "junior"}))
    out["reset"] = await ok(await client.post(f"{URL}/enrollment/reset", headers=h,
                                              json={"book_id": "junior", "confirm": "初中"}))
    return out


async def test_wordbook_payloads_match_the_web_contract(app, client, tmp_path, monkeypatch):
    real = random.Random
    monkeypatch.setattr(random, "Random", lambda seed=0: real(seed))  # 句组抽词固定,样例稳定
    actual = await collect(app, client, tmp_path, monkeypatch)
    assert set(actual) == KEYS | GOALS_KEYS | LEARNED_KEYS | DEFS_KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
                           newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    # 录制的样例里不能有令牌、密钥或本机路径
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw and str(tmp_path.anchor) not in raw.replace("\\\\", "\\")
    # 列表非空(shape 只看第一个元素)、契约里没有以词为键的映射
    for path in (("learn_batch", "cards"), ("learn_batch", "quiz"), ("learn_batch", "drill"), ("review_batch", "questions"),
                 ("review_batch", "cards"), ("spell_sets", "sets"), ("spell_submit", "words"), ("books", "books"),
                 ("learned_list", "items"), ("free_start", "items")):
        assert isinstance(expected[path[0]][path[1]], list) and expected[path[0]][path[1]], path
    assert expected["explain_unavailable"] == {"error": "AI explanation unavailable"}
    # 答题后的选项信息(计划 2026-10-13-review-after-answer S3):学新词的 meaning 题先经 learn/batch 出题,备忘必命中
    choice = expected["answer_choice"]
    assert choice["option_info"] and set(choice["option_info"][0]) == {"option", "word", "defs_zh", "defs_en"}
    assert choice["option_info"][0]["defs_zh"] and choice["correct_option"] in {i["option"] for i in choice["option_info"]}
    assert choice["phrases"] and set(choice["phrases"][0]) == {"en", "zh"} and set(choice["example"]) == {"id", "en", "zh"}
    assert not {"option_info", "phrases", "example"} & set(expected["answer_typed"])  # 非选择题保持旧形状
    assert expected["answer_recall"]["rating"] == "fuzzy"
    assert expected["answer_check"]["outcome"] == "pending" and expected["answer_check"]["check"]["options"]
    assert expected["learned_list"]["next_cursor"] and expected["answer_free"]["applied"] is True
    assert expected["free_start"]["items"][0]["question"]["options"]
    # 英文释义(计划 2026-10-12-wordbook-definitions-server P1):每个返回词卡的端点,首张卡都带 defs_en
    assert expected["config"]["def_lang"] == "en" and expected["def_lang_patch"]["def_lang"] == "zh"
    for cards in (expected["learn_batch"]["cards"], expected["review_batch"]["cards"], [expected["card"]],
                  [expected["learned_card"]], [i["card"] for i in expected["free_start"]["items"]],
                  [w["card"] for w in expected["spell_submit"]["words"]]):
        assert cards[0]["defs_en"] and set(cards[0]["defs_en"][0]) == {"pos", "text"}
    assert "by_book" in expected["learned_summary"] and isinstance(expected["learned_summary"]["by_book"], list)
