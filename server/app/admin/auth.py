"""env 应急超级管理员的凭据比对(管理后台 v2 §4.1)。会话见 sessions.py,权限见 perms.py。"""

import hmac


def credentials_match(settings, username: str, password: str) -> bool:
    # 两项都比较完再合并结果,避免通过短路泄露哪一项错了
    user_ok = hmac.compare_digest(username.strip().encode(), settings.admin_username.strip().encode())
    pass_ok = hmac.compare_digest(password.encode(), settings.admin_password.encode())
    return user_ok and pass_ok
