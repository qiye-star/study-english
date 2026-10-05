import json

from app.routers.conversations import MAX_CONFIG_BYTES

URL = "/api/conversations"


def worst_recap() -> dict:
    """网页端 recap.ts 允许的最大复盘(计划 R13):全是 3 字节的汉字。"""
    return {
        "generated_at": "2026-10-05T12:00:00.000Z",
        "message_count": 1000,
        "level": "B1",
        "summary_zh": "汉" * 400,
        "new_expressions": [{"text": "a" * 80, "zh": "汉" * 60} for _ in range(8)],
        "suggestions_zh": ["汉" * 120 for _ in range(5)],
    }


def full_config() -> dict:
    return {
        "system_prompt": "You are a friendly English conversation partner. " * 6,
        "model": "gpt-4o", "temperature": 0.7, "tts_model": "volcengine/seed-tts-2.0", "tts_voice": "en_female_dacey_uranus_bigtts",
        "bilingual": True, "grammar_check": True, "coach_mode": False, "auto_speak": True, "level": "B1",
        "scenario": {"id": "custom", "custom": "汉" * 500},
        "recap": worst_recap(),
    }


def size(value: dict) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def test_worst_case_recap_is_at_most_6_kb():
    assert size(worst_recap()) <= 6 * 1024


async def test_full_config_is_accepted_on_create_and_patch(client, auth_headers):
    assert size(full_config()) < MAX_CONFIG_BYTES
    r = await client.post(URL, headers=auth_headers, json={"name": "咖啡店点单", "config": full_config()})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = await client.patch(f"{URL}/{cid}", headers=auth_headers, json={"config": full_config()})
    assert r.status_code == 200, r.text
    assert (await client.get(f"{URL}/{cid}", headers=auth_headers)).json()["config"] == full_config()


async def test_oversized_config_is_still_rejected(client, auth_headers):
    r = await client.post(URL, headers=auth_headers, json={"config": {"x": "a" * MAX_CONFIG_BYTES}})
    assert r.status_code == 400 and r.json() == {"error": "Config is too large"}


async def test_oversized_config_is_rejected_on_patch_by_bytes_not_chars(client, auth_headers):
    cid = (await client.post(URL, headers=auth_headers, json={})).json()["id"]
    # fewer characters than the limit, but over it in UTF-8 bytes (3 bytes per Chinese character)
    cfg = {"x": "汉" * (MAX_CONFIG_BYTES // 3)}
    assert len(json.dumps(cfg, ensure_ascii=False)) < MAX_CONFIG_BYTES < size(cfg)
    r = await client.patch(f"{URL}/{cid}", headers=auth_headers, json={"config": cfg})
    assert r.status_code == 400 and r.json() == {"error": "Config is too large"}
