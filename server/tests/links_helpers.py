"""学习联动测试工具(计划 P-L1、P-L6)。"""
import json
import os
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def enable_links(app, **overrides) -> None:
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": True, **overrides})


async def drain(app) -> int:
    return await app.state.learning_bus.drain()


async def user_id_of(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


def shape(value):
    """嵌套键集合(与 tests/test_web_contract.shape 相同;复制一份,免得导入那个测试模块的 rooms 依赖)。"""
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value and isinstance(value[0], (dict, list)) else []
    return None


def check_contract(name: str, actual: dict) -> None:
    """`CONTRACT_UPDATE=1` 重录 `fixtures/<name>.json`;否则按形状比较。样例里不能有令牌或密钥。"""
    fixture = FIXTURES / f"{name}.json"
    if os.environ.get("CONTRACT_UPDATE"):
        fixture.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(fixture.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    raw = fixture.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw
