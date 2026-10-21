"""L5 S11 契约夹具(plan L5 R24):记录配音接口的形状,网页 `dubbing-contract.test.ts` 逐键读它。
`CONTRACT_UPDATE=1 uv run pytest -q tests/test_dubbing_contract.py` 重录;不带变量时按形状比较。
角色名样例不用 "secret" 字样;令牌、票据与密钥都不出现在夹具里。"""
import uuid

import pytest

from app.dubbing import errors
from app.library import roles_ai
from app.providers.xfyun_result import to_assessment
from app.models import Assessment
from tests.agents_helpers import check_contract
from tests.dubbing_helpers import LLM_BASE, make_item, user_id_of, dubbing_settings
from tests.library_helpers import enable
from tests.test_xfyun_result import REFERENCE, load


@pytest.fixture
def settings_overrides(tmp_path):
    return dubbing_settings(tmp_path, library_ai_enabled=True, upstream_llm_base_url=LLM_BASE)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def test_the_dubbing_contract_shapes(app, client, auth_headers, monkeypatch):
    uid = await user_id_of(app)
    lines = [(0, 900, "Hello there."), (1000, 1900, "How are you?"), (2000, 2900, "I am fine.")]
    item = await make_item(app, uid, lines, speakers=["A", "B", "A"])

    async def complete(http, settings, messages, **kwargs):
        return "1. A\n2. B\n3. A"

    monkeypatch.setattr(roles_ai.llm, "complete", complete)
    out: dict = {"errors": {code: text for code, (_status, text) in errors.API_ERRORS.items()}}
    out["config"] = (await client.get("/api/dubbing/config", headers=auth_headers)).json()
    out["roles_get"] = (await client.get(f"/api/dubbing/items/{item}/roles", headers=auth_headers)).json()
    out["roles_put"] = (await client.put(f"/api/dubbing/items/{item}/roles", headers=auth_headers,
                                         json={"names": {"A": "Host"},
                                               "speakers": [{"idx": 0, "speaker": "A"}]})).json()
    out["suggest"] = (await client.post(f"/api/dubbing/items/{item}/roles/suggest", headers=auth_headers,
                                        json={"seg_from": 0, "seg_to": 2})).json()
    created = await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                                json={"seg_from": 0, "seg_to": 2, "role": "A"})
    out["take_create"] = created.json()
    take = created.json()["take"]["id"]
    out["takes_list"] = (await client.get(f"/api/dubbing/items/{item}/takes", headers=auth_headers)).json()
    aid = str(uuid.uuid4())
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id=aid, user_id=uid, reference_text="Hello there.", language="en", duration_ms=5200,
                         audio_bytes=1, scores={}, result=to_assessment(load("ise_good.xml"), REFERENCE),
                         audio_path="x/y.wav", source="library"))
        await s.commit()
    out["line"] = (await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers,
                                     json={"seg_idx": 0, "assessment_id": aid, "rec_start_ms": 0,
                                           "voiced_ms": 800, "capture": "pcm"})).json()
    out["finish"] = (await client.post(f"/api/dubbing/takes/{take}/finish", headers=auth_headers)).json()
    out["take_detail"] = (await client.get(f"/api/dubbing/takes/{take}", headers=auth_headers)).json()
    check_contract("dubbing_contract", out)
