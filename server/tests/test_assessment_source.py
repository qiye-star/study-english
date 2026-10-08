import pytest
from sqlalchemy import select

from app.models import Assessment
from app.services.provider_clients import get_xfyun
from app.providers.xfyun_result import to_assessment
from tests.test_assessment_save import GOOD_XML, REFERENCE, FakeXfyun, make_wav

URL = "/api/speech/assessments"


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


@pytest.fixture
def fake(app):
    f = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: f
    return f


def post(client, headers, **fields):
    data = {"reference": REFERENCE, "language": "en-US", **fields}
    return client.post(URL, headers=headers, data=data, files={"file": ("a.wav", make_wav(), "audio/wav")})


async def sources(app) -> list[str]:
    async with app.state.sessionmaker() as s:
        return sorted((await s.execute(select(Assessment.source))).scalars().all())


async def test_saved_source_defaults_to_practice_and_accepts_chat(app, client, auth_headers, fake):
    assert (await post(client, auth_headers, save="true")).status_code == 200
    assert (await post(client, auth_headers, save="true", source=" CHAT ")).status_code == 200
    assert await sources(app) == ["chat", "practice"]


async def test_invalid_source_is_rejected_before_the_upstream_call(app, client, auth_headers, fake):
    r = await post(client, auth_headers, save="true", source="evil")
    assert r.status_code == 400 and r.json() == {"error": "Invalid source"}
    assert fake.calls == [] and await sources(app) == []


async def test_source_without_save_changes_nothing(app, client, auth_headers, fake):
    r = await post(client, auth_headers, source="evil")
    assert r.status_code == 200 and r.json() == to_assessment(GOOD_XML, REFERENCE)
    assert await sources(app) == []


async def test_list_filters_by_source(app, client, auth_headers, fake):
    practice = (await post(client, auth_headers, save="true")).json()["assessment_id"]
    chat = (await post(client, auth_headers, save="true", source="chat")).json()["assessment_id"]

    async def ids(**params):
        r = await client.get("/api/assessments", headers=auth_headers, params=params)
        assert r.status_code == 200
        return {a["id"] for a in r.json()["assessments"]}

    assert await ids() == {practice}
    assert await ids(source="practice") == {practice}
    assert await ids(source="chat") == {chat}
    assert await ids(source="all") == {practice, chat}
    assert (await client.get("/api/assessments", headers=auth_headers, params={"source": "x"})).status_code == 422
