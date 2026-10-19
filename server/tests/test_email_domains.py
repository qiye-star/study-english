"""邮箱域名策略(计划 S13;spec §4.3):纯函数,设置作为参数。"""
import inspect

import pytest

from app.services import email_domains
from app.services.email_domains import BUILTIN_ALLOWED, BUILTIN_BLOCKED, domain_allowed
from tests.conftest import make_settings


def _s(**kw):
    return make_settings(**kw)


def test_blocklist_default_refuses_builtin_disposable_domains_and_their_subdomains():
    s = _s()
    assert s.email_domain_mode == "blocklist"
    assert not domain_allowed(s, "a@mailinator.com")
    assert not domain_allowed(s, "a@x.mailinator.com")
    assert not domain_allowed(s, "A@MAILINATOR.COM")
    assert domain_allowed(s, "a@qq.com")
    assert domain_allowed(s, "a@gmail.com")
    assert domain_allowed(s, "a@notmailinator.com")  # a suffix match must be on a dot boundary


def test_blocklist_list_is_appended_to_the_builtin_table():
    s = _s(email_domain_list="Spam.example, @bad.test ,.worse.test")
    assert not domain_allowed(s, "a@spam.example")
    assert not domain_allowed(s, "a@sub.spam.example")
    assert not domain_allowed(s, "a@bad.test")
    assert not domain_allowed(s, "a@worse.test")
    assert not domain_allowed(s, "a@mailinator.com")  # the built-in table still applies
    assert domain_allowed(s, "a@qq.com")


def test_allowlist_with_an_empty_list_uses_the_builtin_domestic_providers():
    s = _s(email_domain_mode="allowlist")
    for domain in ("qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "sina.com", "sina.cn", "sohu.com",
                   "aliyun.com", "139.com", "189.cn"):
        assert domain_allowed(s, f"a@{domain}"), domain
    assert not domain_allowed(s, "a@gmail.com")
    assert not domain_allowed(s, "a@mailinator.com")
    assert set(BUILTIN_ALLOWED) >= {"qq.com", "foxmail.com", "163.com"}


def test_allowlist_with_a_list_uses_exactly_that_list():
    s = _s(email_domain_mode="allowlist", email_domain_list="school.edu, example.org")
    assert domain_allowed(s, "a@school.edu")
    assert domain_allowed(s, "a@mail.school.edu")
    assert domain_allowed(s, "a@example.org")
    assert not domain_allowed(s, "a@qq.com")  # the built-in list is replaced, not extended


def test_any_mode_allows_everything_including_disposable_domains():
    s = _s(email_domain_mode="any")
    assert domain_allowed(s, "a@mailinator.com")
    assert domain_allowed(s, "a@whatever.test")


def test_builtin_blocklist_is_a_small_lowercase_table():
    assert 10 <= len(BUILTIN_BLOCKED) <= 40
    assert all(d == d.lower() and "." in d for d in BUILTIN_BLOCKED)
    assert "mailinator.com" in BUILTIN_BLOCKED


@pytest.mark.parametrize("bad", ["", "noat", "a@", "@qq.com", "a@b@qq.com"])
def test_malformed_addresses_are_refused_in_every_mode(bad):
    for mode in ("any", "allowlist", "blocklist"):
        assert not domain_allowed(_s(email_domain_mode=mode), bad)


def test_module_never_logs():
    assert "logging" not in inspect.getsource(email_domains)
