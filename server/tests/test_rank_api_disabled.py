import pytest

ENDPOINTS = [
    ("get", "/api/rank/me"), ("get", "/api/rank/achievements"), ("get", "/api/rank/matches"),
    ("post", "/api/rank/matches"), ("get", "/api/rank/matches/x"), ("post", "/api/rank/matches/x/turns"),
    ("post", "/api/rank/matches/x/finish"), ("post", "/api/rank/matches/x/abandon"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
async def test_rank_endpoints_are_404_when_disabled(client, auth_headers, method, path):
    r = await getattr(client, method)(path, headers=auth_headers)
    assert (r.status_code, r.json()) == (404, {"error": "Rank is disabled"})


@pytest.mark.parametrize("method,path", ENDPOINTS)
async def test_rank_endpoints_require_auth(client, method, path):
    assert (await getattr(client, method)(path)).status_code == 401
