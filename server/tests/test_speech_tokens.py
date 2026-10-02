import httpx
import pytest

STS = "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken"


async def test_requires_auth(client):
    assert (await client.post("/api/speech/tokens", json={})).status_code == 401


async def test_issues_token_with_region(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    r = await client.post(
        "/api/speech/tokens",
        json={"purpose": "transcribe", "target_type": "Audio", "target_id": 42},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["id"], int)
    assert body["token"] == "jwt-1"
    assert body["region"] == "eastus"


async def test_empty_body_is_accepted(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 200


async def test_token_is_cached_across_requests(client, auth_headers, respx_mock):
    route = respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    for _ in range(3):
        await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert route.call_count == 1


async def test_consume_and_revoke(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "consumed"}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": tid, "state": "consumed"}
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "revoked"}, headers=auth_headers)
    assert r.json()["state"] == "revoked"


async def test_invalid_state_is_422(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "bogus"}, headers=auth_headers)
    assert r.status_code == 422


async def test_cannot_update_someone_elses_token(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "consumed"}, headers=other_headers)
    assert r.status_code == 404


async def test_azure_failure_is_502(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(500, text="oops"))
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Azure unavailable"


@pytest.mark.parametrize(
    "settings_overrides", [{"azure_speech_key": "", "azure_speech_region": ""}], indirect=True
)
async def test_unconfigured_is_503(client, auth_headers):
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 503
    assert r.json()["error"] == "Azure Speech is not configured"


@pytest.mark.parametrize("tid", [0, -1, 2**31])
async def test_token_id_out_of_range_is_422(client, auth_headers, tid):
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "consumed"}, headers=auth_headers)
    assert r.status_code == 422
