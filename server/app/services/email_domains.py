"""邮箱域名策略(计划 S13;spec §4.3):`EMAIL_DOMAIN_MODE` = any / allowlist / blocklist。

纯函数:设置作为参数传入;不记录日志。比较在点边界上:`x.mailinator.com` 命中 `mailinator.com`,
`notmailinator.com` 不命中。
"""
from app.core.config import Settings

# 内置临时 / 一次性邮箱域名。不求全,只挡最常见的;管理员可在 EMAIL_DOMAIN_LIST 里追加。
BUILTIN_BLOCKED = frozenset({
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
    "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "throwawaymail.com", "getnada.com",
    "dispostable.com", "maildrop.cc", "fakeinbox.com", "mintemail.com", "moakt.com", "mohmal.com",
    "emailondeck.com",
})
# allowlist 模式下名单为空时的内置国内主流邮箱。
BUILTIN_ALLOWED = frozenset({
    "qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "sina.com", "sina.cn", "sohu.com",
    "aliyun.com", "139.com", "189.cn",
})


def _listed(value: str) -> frozenset[str]:
    items = (item.strip().lower().lstrip("@.") for item in value.split(","))
    return frozenset(item for item in items if item)


def _matches(domain: str, names: frozenset[str]) -> bool:
    return any(domain == name or domain.endswith("." + name) for name in names)


def domain_allowed(settings: Settings, email: str) -> bool:
    """Whether the address's domain passes the configured policy. A malformed address (no single `@`, empty
    parts) is never allowed, in any mode; full address validation is `identities.normalize_email`."""
    if not isinstance(email, str) or email.count("@") != 1:
        return False
    local, domain = email.strip().lower().split("@")
    if not local or not domain:
        return False
    mode = settings.email_domain_mode
    if mode == "any":
        return True
    listed = _listed(settings.email_domain_list)
    if mode == "allowlist":
        return _matches(domain, listed or BUILTIN_ALLOWED)
    return not _matches(domain, BUILTIN_BLOCKED | listed)
