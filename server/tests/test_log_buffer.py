import logging

from app.core import log_buffer
from app.core.log_buffer import RingBufferHandler, redact


def test_redacts_tickets_bearer_kv_json_and_known_secrets():
    text = ('GET /api/rooms/ws?ticket=abc123 Authorization: Bearer tok.en.value api_key=sk-1 '
            '{"password": "hunter22"} upstream said sk-live-9999999 X-Api-Key: uuid-key-1 csrf=c5rf')
    out = redact(text, frozenset({"sk-live-9999999", "abc"}))
    for leaked in ("abc123", "tok.en.value", "sk-1 ", "hunter22", "sk-live-9999999", "uuid-key-1", "c5rf"):
        assert leaked not in out
    assert "[redacted]" in out
    assert redact("abc is short", frozenset({"abc"})) == "abc is short"  # < 6 chars: not treated as a secret


def test_ring_buffer_capacity_filters_and_incremental_reads():
    handler = RingBufferHandler(capacity=3)
    logger = logging.getLogger("app.test_ring")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        for i in range(5):
            logger.info("event %s", i)
        logger.warning("boom")
    finally:
        logger.removeHandler(handler)
        logger.setLevel(logging.NOTSET)
    entries = handler.query(level=None, logger_prefix=None, q=None, after_id=None)
    assert [e.message for e in entries] == ["event 3", "event 4", "boom"]
    assert [e.message for e in handler.query(level="WARNING", logger_prefix="app", q=None, after_id=None)] == ["boom"]
    assert handler.query(level=None, logger_prefix="uvicorn", q=None, after_id=None) == []
    assert [e.message for e in handler.query(level=None, logger_prefix=None, q="EVENT 4", after_id=None)] == ["event 4"]
    last = entries[-2].id
    assert [e.message for e in handler.query(level=None, logger_prefix=None, q=None, after_id=last)] == ["boom"]
    assert [e.message for e in handler.query(level=None, logger_prefix=None, q=None, after_id=None, limit=1)] == ["boom"]


def test_long_messages_are_truncated():
    handler = RingBufferHandler(capacity=2)
    record = logging.LogRecord("app.x", logging.INFO, __file__, 1, "x" * 5000, None, None)
    handler.handle(record)
    assert len(handler.query(level=None, logger_prefix=None, q=None, after_id=None)[0].message) == 2000


def test_secret_values_from_settings_are_redacted(app, caplog):
    log_buffer.set_secrets(["llm-secret-value"])
    logging.getLogger("app.x").warning("calling with llm-secret-value")
    entries = log_buffer.BUFFER.query(level=None, logger_prefix=None, q=None, after_id=None)
    assert any("calling with [redacted]" == e.message for e in entries)
    assert all("llm-secret-value" not in e.message for e in entries)


def test_app_settings_secrets_are_registered(app):
    logging.getLogger("app.y").warning("key is %s", app.state.settings.upstream_llm_key)
    last = log_buffer.BUFFER.query(level=None, logger_prefix="app.y", q=None, after_id=None)[-1]
    assert app.state.settings.upstream_llm_key not in last.message
