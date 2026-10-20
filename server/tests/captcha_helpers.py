"""人机验证测试辅助(计划 S8):开启人机验证、用官方库解题、拼 X-Captcha 载荷。

解题用官方 `altcha.solve_challenge`(与网页组件同一算法);挑战的 counter 由服务端选,测试里 cost=1,解题很快。
"""
import base64
import json

import altcha

SECRET = "test-captcha-secret-" + "x" * 20  # >= 32 字符


def enable_captcha(app, mode="adaptive", **overrides) -> None:
    """热改测试应用的人机验证设置(每次请求读取 app.state.settings)。cost=1、counter_max=10 让解题很快。"""
    values = {"captcha_mode": mode, "captcha_secret": SECRET, "captcha_cost": 1, "captcha_counter_max": 10}
    values.update(overrides)
    app.state.settings = app.state.settings.model_copy(update=values)


def solve(challenge: dict) -> str:
    """把签发的挑战用官方库解出,拼成 X-Captcha 的值(base64 的 JSON:challenge + solution)。"""
    solved = altcha.solve_challenge(altcha.Challenge.from_dict(challenge), counter_start=0)
    assert solved is not None
    payload = {"challenge": challenge, "solution": solved.to_dict()}
    return base64.b64encode(json.dumps(payload).encode()).decode()


async def header_for(client) -> dict:
    """取一个新挑战、解出、返回可直接 `headers=` 使用的字典。"""
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 200, r.text
    return {"X-Captcha": solve(r.json())}
