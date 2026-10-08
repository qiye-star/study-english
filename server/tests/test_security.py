from app.core.security import hash_password, hash_token, new_token, verify_password


def test_password_roundtrip():
    h = hash_password("correct horse")
    assert h != "correct horse"
    assert verify_password(h, "correct horse") is True
    assert verify_password(h, "wrong") is False


def test_verify_password_rejects_garbage_hash():
    assert verify_password("not-a-hash", "x") is False


def test_token_helpers():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 32
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != a and len(hash_token(a)) == 64
