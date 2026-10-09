import pytest
from cryptography.fernet import Fernet

from app.core.secretbox import SecretBox, SecretBoxError, box_for, fingerprint
from tests.conftest import make_settings


def test_round_trip_and_tamper_detection():
    box = SecretBox(Fernet.generate_key().decode())
    token = box.encrypt("sk-live-abc")
    assert "sk-live-abc" not in token
    assert box.decrypt(token) == "sk-live-abc"
    with pytest.raises(SecretBoxError):
        box.decrypt(token[:-2] + "AA")
    with pytest.raises(SecretBoxError):
        SecretBox(Fernet.generate_key().decode()).decrypt(token)


def test_invalid_key_and_error_messages_never_echo_input():
    with pytest.raises(SecretBoxError) as exc:
        SecretBox("not-a-key-sk-live-abc")
    assert "sk-live-abc" not in str(exc.value)


def test_box_for_requires_encryption_key():
    assert box_for(make_settings()) is None
    assert isinstance(box_for(make_settings(settings_encryption_key=Fernet.generate_key().decode())), SecretBox)


def test_fingerprint_is_stable_short_and_keyed():
    a = fingerprint(b"k1", "sk-live-abc")
    assert a == fingerprint(b"k1", "sk-live-abc") and len(a) == 8
    assert a != fingerprint(b"k2", "sk-live-abc")
    assert fingerprint(b"k1", "") == ""


def test_settings_reject_a_bad_encryption_key_without_echoing_it():
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as exc:
        make_settings(settings_encryption_key="not-a-key-sk-live-abc")
    assert "sk-live-abc" not in str(exc.value)
    assert "not a valid Fernet key" in str(exc.value)
