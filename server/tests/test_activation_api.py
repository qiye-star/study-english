"""词汇激活接口的开关行为(plan L4 Task 4):关 = /api/activation/* 除 config 外 404;config 永远 200。"""


def enable(app, on: bool) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


async def test_config_is_200_either_way_and_says_whether_it_is_on(app, client, auth_headers):
    r = await client.get("/api/activation/config", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"enabled": False}
    enable(app, True)
    r = await client.get("/api/activation/config", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"enabled": True}


async def test_words_is_404_while_the_switch_is_off(client, auth_headers):
    r = await client.get("/api/activation/words?state=dormant", headers=auth_headers)
    assert r.status_code == 404
    assert r.json() == {"error": "Activation is off"}


async def test_words_answers_when_the_switch_is_on(app, client, auth_headers):
    enable(app, True)
    r = await client.get("/api/activation/words?state=dormant", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["items"] == []  # placeholder until L4 Task 11 fills the dormant list
