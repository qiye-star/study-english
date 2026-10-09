"""管理端测试工具:按角色登录(库内账号)、密钥泄露扫描。"""
import json

from app.admin.accounts import create_account
from app.core.settings_registry import SECRETS

ADMIN_ENABLED = {
    "admin_username": "root", "admin_password": "correct-horse-battery", "admin_session_secret": "s3cret",
    "admin_cookie_secure": False,
}
PASSWORD = "long-enough-password-1"


async def login_as(app, client, role: str = "superadmin", username: str | None = None) -> dict[str, str]:
    if role == "env":
        body = {"username": "root", "password": "correct-horse-battery"}
    else:
        username = username or f"{role}1"
        async with app.state.sessionmaker() as s:
            await create_account(s, username=username, password=PASSWORD, role=role, created_by="test")
            await s.commit()
        body = {"username": username, "password": PASSWORD}
    r = await client.post("/api/admin/login", json=body)
    assert r.status_code == 200, r.text
    return {"X-Admin-CSRF": r.json()["csrf_token"]}


def assert_no_secrets(payload: object, settings) -> None:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    for key in SECRETS:
        value = str(getattr(settings, key, "") or "")
        if len(value) >= 6:
            assert value not in text, f"secret {key} leaked"


async def draft_etag(client, publish_path: str) -> str:
    """The etag of the draft behind a `.../draft/publish` path (rank rules or a prompt), "no-draft" when there is none."""
    draft = (await client.get(publish_path.removesuffix("/draft/publish"))).json().get("draft")
    return (draft or {}).get("etag") or "no-draft"


async def publish_draft(client, publish_path: str, headers: dict, reason: str):
    """Publish the current draft as reviewed: sends its etag (review M4)."""
    return await client.post(publish_path, headers=headers,
                             json={"reason": reason, "draft_etag": await draft_etag(client, publish_path)})
