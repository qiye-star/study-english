"""Captcha payload shapes the web client mirrors (plan S13; spec §6, §8).

The real app answers the config and challenge endpoints and the three captcha errors; every body is compared by
*shape* (nested key sets) with `fixtures/captcha_contract.json`, which the web captcha tests read. Random values
(nonce, salt, key prefix, key signature, signature) and the expiry are written as fixed placeholders, and the
recording itself checks that none of the live values reached the fixture.
Re-record after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_captcha_contract.py`
(PowerShell: `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_captcha_contract.py; Remove-Item Env:CONTRACT_UPDATE`).
"""
import json
import os
import re
from pathlib import Path

from tests.captcha_helpers import SECRET, enable_captcha
from tests.links_helpers import shape

FIXTURE = Path(__file__).parent / "fixtures" / "captcha_contract.json"
KEYS = {"config_off", "config_adaptive", "challenge", "error_required", "error_invalid", "error_not_configured",
        "error_off"}
RANDOM_PARAMETERS = ("nonce", "salt", "keyPrefix", "keySignature")
BODY = {"username": "contract_user", "password": "contract-password-1"}


def redact(challenge: dict) -> dict:
    """Fixed placeholders for the random fields and the expiry; everything else keeps its real value."""
    out = json.loads(json.dumps(challenge))
    for key in RANDOM_PARAMETERS:
        out["parameters"][key] = "REDACTED"
    out["parameters"]["expiresAt"] = 0
    out["signature"] = "REDACTED"
    return out


async def _record(app, client) -> tuple[dict, list[str]]:
    got: dict = {}
    r = await client.get("/api/captcha/config")
    assert r.status_code == 200, r.text
    got["config_off"] = r.json()
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 404, r.text
    got["error_off"] = r.json()

    enable_captcha(app, "adaptive")
    r = await client.get("/api/captcha/config")
    assert r.status_code == 200, r.text
    got["config_adaptive"] = r.json()
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 200, r.text
    live = r.json()
    got["challenge"] = redact(live)
    live_values = [live["parameters"][k] for k in RANDOM_PARAMETERS] + [live["signature"]]

    r = await client.post("/api/users", json=BODY)
    assert r.status_code == 428, r.text
    got["error_required"] = r.json()
    r = await client.post("/api/users", json=BODY, headers={"X-Captcha": "not-a-payload!!"})
    assert r.status_code == 428, r.text
    got["error_invalid"] = r.json()

    enable_captcha(app, "adaptive", captcha_secret="")
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 503, r.text
    got["error_not_configured"] = r.json()
    return got, live_values


async def test_captcha_payloads_match_the_web_contract(app, client):
    actual, live_values = await _record(app, client)
    assert set(actual) == KEYS
    assert actual["config_off"] == {"mode": "off"}
    assert actual["config_adaptive"] == {"mode": "adaptive"}
    assert actual["error_off"] == {"error": "Captcha is off"}
    assert actual["error_required"] == {"error": "captcha_required"}
    assert actual["error_invalid"] == {"error": "captcha_invalid"}
    assert actual["error_not_configured"] == {"error": "Captcha is not configured"}
    assert set(actual["challenge"]) == {"parameters", "signature"}
    serialized = json.dumps(actual)
    for value in live_values:
        assert value not in serialized  # the recording holds placeholders, not this run's random values
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(expected) == KEYS
    assert shape(actual) == shape(expected)
    assert actual == expected


def test_the_fixture_holds_only_placeholders():
    raw = FIXTURE.read_text(encoding="utf-8")
    for forbidden in (SECRET, "test-captcha-secret", "contract-password-1", "contract_user", "X-Captcha", "Bearer"):
        assert forbidden not in raw
    assert not re.search(r"[0-9a-fA-F]{32,}", raw)  # no nonce, salt, key or signature in hex
    assert not re.search(r"[A-Za-z0-9+/=_-]{40,}", raw)  # no base64 payload
    data = json.loads(raw)
    assert data["challenge"]["parameters"]["expiresAt"] == 0
    for key in RANDOM_PARAMETERS:
        assert data["challenge"]["parameters"][key] == "REDACTED"
    assert data["challenge"]["signature"] == "REDACTED"
