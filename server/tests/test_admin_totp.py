from app.admin import totp

# RFC 6238 附录 B,SHA-1,种子 "12345678901234567890" 的 base32
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


def test_rfc6238_vectors_last_six_digits():
    assert totp.code_at(RFC_SECRET, 59 // 30) == "287082"
    assert totp.code_at(RFC_SECRET, 1111111109 // 30) == "081804"
    assert totp.code_at(RFC_SECRET, 1234567890 // 30) == "005924"


def test_verify_window_and_replay():
    now = 1234567890.0
    step = int(now // 30)
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step - 1), now, None) == step - 1
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step + 2), now, None) is None
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step), now, step) is None  # replay
    assert totp.verify(RFC_SECRET, "12345", now, None) is None


def test_secret_uri_and_recovery_codes():
    secret = totp.generate_secret()
    assert len(secret) == 32 and secret.isupper()
    uri = totp.provisioning_uri(secret, "ops")
    assert uri.startswith("otpauth://totp/Enjoy%20Admin:ops?") and f"secret={secret}" in uri
    codes = totp.new_recovery_codes()
    assert len(codes) == 8 and len(set(codes)) == 8 and all(len(c) == 9 and c[4] == "-" for c in codes)
