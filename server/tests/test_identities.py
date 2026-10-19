"""邮箱身份(计划 S13;R-F1、X9):规范化、HMAC 查找键、加密副本、脱敏、绑定。"""
import hashlib
import inspect
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import func, select

from app.core.secretbox import box_for
from app.models import User, UserIdentity
from app.services import identities
from app.services.identities import (EmailNotConfigured, EmailTaken, bind_email, clear_email, decrypt_email,
                                     email_ready, encrypt_email, find_user_by_email, identity_key, mask_email,
                                     normalize_email, subject_hmac)
from tests.conftest import make_settings

PEPPER = "p" * 40
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)


def _settings(**kw):
    base = dict(identity_pepper=PEPPER, settings_encryption_key=Fernet.generate_key().decode(), email_backend="console")
    base.update(kw)
    return make_settings(**base)


def test_normalize_email_trims_and_lowercases():
    assert normalize_email(" A.B+tag@QQ.com ") == "a.b+tag@qq.com"


def test_identity_key_drops_the_plus_tag_but_keeps_dots():
    assert identity_key(" A.B+tag@QQ.com ") == "a.b@qq.com"
    assert identity_key("a.b@qq.com") == "a.b@qq.com"
    assert identity_key("a+x+y@qq.com") == "a@qq.com"
    assert identity_key("a.b@qq.com") != identity_key("ab@qq.com")  # dots are NOT folded (spec section 3)


@pytest.mark.parametrize("bad", [
    "", "   ", "plain", "a@", "@qq.com", "a@b@qq.com", "a@nodot", "a@.qq.com", "a@qq.com.", "a@qq..com",
    "a@-qq.com", "a@qq-.com",
    "邮箱@qq.com", "a@例子.com", "a@qq.com\r\nBcc: x@y.z", "a@qq.com\n", "a b@qq.com", "a\tb@qq.com",
    "a@q q.com", "a@qq.com\x00", "\ra@qq.com", "a..b@qq.com", ".a@qq.com", "a.@qq.com", "a@qq_com.com",
    "a" * 65 + "@qq.com", "a@" + "b" * 250 + ".com",
])
def test_invalid_addresses_are_refused_with_a_fixed_message(bad):
    with pytest.raises(ValueError) as info:
        normalize_email(bad)
    assert str(info.value) == "invalid email"
    with pytest.raises(ValueError):
        identity_key(bad)


def test_length_limits_are_exact():
    assert normalize_email("a" * 64 + "@qq.com") == "a" * 64 + "@qq.com"
    ok = "x@" + ".".join(["b" * 60] * 3) + ".com"
    assert len(ok) <= 254
    assert normalize_email(ok) == ok
    too_long = "x@" + ".".join(["b" * 60] * 5) + ".com"
    assert len(too_long) > 254
    with pytest.raises(ValueError):
        normalize_email(too_long)


def test_identity_key_refuses_an_empty_local_part_after_the_tag():
    assert normalize_email("+tag@qq.com") == "+tag@qq.com"
    with pytest.raises(ValueError):
        identity_key("+tag@qq.com")


def test_identity_key_refuses_an_empty_local_part_after_the_tag():
    assert normalize_email("+tag@qq.com") == "+tag@qq.com"
    with pytest.raises(ValueError):
        identity_key("+tag@qq.com")


def test_non_string_is_refused():
    with pytest.raises(ValueError):
        normalize_email(None)  # type: ignore[arg-type]


def test_subject_hmac_is_deterministic_and_depends_on_the_pepper():
    a = subject_hmac(PEPPER, "A.B+x@QQ.com")
    assert a == subject_hmac(PEPPER, "a.b@qq.com")  # same identity key
    assert len(a) == 64 and all(c in "0123456789abcdef" for c in a)
    assert subject_hmac("q" * 40, "a.b@qq.com") != a
    assert subject_hmac(PEPPER, "a.c@qq.com") != a
    assert "a.b" not in a


def test_subject_hmac_is_keyed_not_a_plain_hash():
    assert subject_hmac(PEPPER, "a@qq.com") != hashlib.sha256(b"email:a@qq.com").hexdigest()


def test_encrypt_decrypt_round_trip_keeps_the_plus_tag():
    box = box_for(_settings())
    token = encrypt_email(box, " Alice+Tag@QQ.com ")
    assert "alice" not in token.lower()
    assert decrypt_email(box, token) == "alice+tag@qq.com"


def test_mask_email():
    assert mask_email("alice@qq.com") == "a***@qq.com"
    assert mask_email("a@qq.com") == "a***@qq.com"
    assert mask_email("Alice+x@QQ.com") == "a***@qq.com"
    assert "lice" not in mask_email("alice@qq.com")


def test_email_ready_needs_both_keys_and_a_backend():
    assert email_ready(_settings()) is True
    assert email_ready(_settings(identity_pepper="")) is False
    assert email_ready(_settings(settings_encryption_key="")) is False
    assert email_ready(_settings(email_backend="off")) is False
    broken = _settings().model_copy(update={"settings_encryption_key": "not-a-fernet-key"})  # skips validation
    assert email_ready(broken) is False
    assert email_ready(_settings(email_backend="smtp")) is True


async def _user(app, uid, name):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=name, password_hash="x"))
        await s.commit()


async def test_bind_find_and_clear(app):
    settings = _settings()
    await _user(app, 11111111, "alice")
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        await bind_email(s, settings, user, "Alice+Tag@QQ.com", NOW)
        await s.commit()
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        assert user.email_verified_at is not None
        row = (await s.execute(select(UserIdentity).where(UserIdentity.user_id == 11111111))).scalar_one()
        assert row.provider == "email"
        assert row.subject_hmac == subject_hmac(PEPPER, "alice@qq.com")
        assert "alice" not in row.subject_enc.lower()
        assert decrypt_email(box_for(settings), row.subject_enc) == "alice+tag@qq.com"
        # the lookup uses the identity key: tag and case variants find the same user
        for variant in ("alice@qq.com", " ALICE+other@QQ.COM "):
            found = await find_user_by_email(s, settings, variant)
            assert found is not None and found.id == 11111111
        assert await find_user_by_email(s, settings, "bob@qq.com") is None
        assert await find_user_by_email(s, settings, "not an email") is None
        await clear_email(s, user)
        await s.commit()
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        assert user.email_verified_at is None
        assert await s.scalar(select(func.count()).select_from(UserIdentity)) == 0
        assert await find_user_by_email(s, settings, "alice@qq.com") is None


async def test_rebinding_replaces_the_identity_of_the_same_user(app):
    settings = _settings()
    await _user(app, 11111111, "alice")
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        await bind_email(s, settings, user, "old@qq.com", NOW)
        await s.commit()
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        await bind_email(s, settings, user, "new@qq.com", NOW + timedelta(days=1))
        await s.commit()
    async with app.state.sessionmaker() as s:
        rows = (await s.execute(select(UserIdentity))).scalars().all()
        assert len(rows) == 1 and rows[0].subject_hmac == subject_hmac(PEPPER, "new@qq.com")
        assert await find_user_by_email(s, settings, "old@qq.com") is None
        assert (await find_user_by_email(s, settings, "new@qq.com")).id == 11111111


async def test_binding_an_email_that_belongs_to_another_user_raises_email_taken(app):
    settings = _settings()
    await _user(app, 11111111, "alice")
    await _user(app, 22222222, "bob")
    async with app.state.sessionmaker() as s:
        await bind_email(s, settings, await s.get(User, 11111111), "shared@qq.com", NOW)
        await s.commit()
    async with app.state.sessionmaker() as s:
        bob = await s.get(User, 22222222)
        with pytest.raises(EmailTaken) as info:
            await bind_email(s, settings, bob, "shared+tag@qq.com", NOW)  # same identity key
        assert "shared" not in str(info.value)
        await s.rollback()
    async with app.state.sessionmaker() as s:
        assert (await s.get(User, 22222222)).email_verified_at is None


async def test_bind_refuses_when_email_is_not_configured(app):
    await _user(app, 11111111, "alice")
    async with app.state.sessionmaker() as s:
        user = await s.get(User, 11111111)
        for settings in (_settings(identity_pepper=""), _settings(settings_encryption_key="")):
            with pytest.raises(EmailNotConfigured):
                await bind_email(s, settings, user, "a@qq.com", NOW)


def test_module_never_logs():
    assert "logging" not in inspect.getsource(identities)
