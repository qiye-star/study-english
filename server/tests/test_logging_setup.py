import io
import logging

import pytest

from app.core.logging_setup import configure_logging
from app.core.timing import log_timing


@pytest.fixture
def clean_logging(monkeypatch):
    app_logger = logging.getLogger("app")
    saved = (app_logger.handlers[:], app_logger.level, app_logger.propagate)

    def bare():
        # simulate uvicorn: bare root logger (pytest re-adds its handlers per phase, so call in the test body)
        monkeypatch.setattr(logging.getLogger(), "handlers", [])
        app_logger.handlers = []
        app_logger.propagate = True
        app_logger.setLevel(logging.NOTSET)

    yield bare
    app_logger.handlers, app_logger.level, app_logger.propagate = saved[0], saved[1], saved[2]


def test_timing_info_reaches_the_handler_when_root_is_bare(clean_logging):
    clean_logging()
    stream = io.StringIO()
    configure_logging("INFO", stream)
    log_timing("stt_chat", ms=5, status=200)
    assert "timing event=stt_chat ms=5 status=200" in stream.getvalue()


def test_level_is_overridable_and_bad_values_fall_back(clean_logging):
    clean_logging()
    stream = io.StringIO()
    configure_logging("WARNING", stream)
    log_timing("stt_chat", ms=5)
    assert stream.getvalue() == ""
    configure_logging("nonsense", stream)  # second call only adjusts the level
    log_timing("stt_chat", ms=6)
    assert "ms=6" in stream.getvalue()


def test_existing_handlers_are_left_alone(monkeypatch):
    app_logger = logging.getLogger("app")
    before = app_logger.handlers[:]
    configure_logging("INFO", io.StringIO())  # pytest's root handlers are present
    assert app_logger.handlers == before


def test_create_app_installs_logging(clean_logging):
    clean_logging()
    from app.main import create_app
    from tests.conftest import make_settings

    create_app(make_settings())
    log_timing("stt_chat", ms=1)
    assert any(getattr(h, "_enjoy_app_handler", False) for h in logging.getLogger("app").handlers)


# ---------------------------------------------------------------- realtime ticket redaction


@pytest.fixture
def uvicorn_loggers():
    names = ("uvicorn", "uvicorn.error", "uvicorn.access")
    saved = {n: (logging.getLogger(n).handlers[:], logging.getLogger(n).level, logging.getLogger(n).propagate,
                 logging.getLogger(n).filters[:]) for n in names}
    yield
    for n, (handlers, level, propagate, filters) in saved.items():
        lg = logging.getLogger(n)
        lg.handlers, lg.level, lg.propagate, lg.filters = handlers, level, propagate, filters


def _record(name, msg, args):
    return logging.getLogger(name).makeRecord(name, logging.INFO, __file__, 1, msg, args, None)


def test_redaction_keeps_the_access_formatter_args_shape(uvicorn_loggers):
    from uvicorn.logging import AccessFormatter

    from app.core.logging_setup import QuerySecretFilter

    record = _record("uvicorn.access", '%s - "%s %s HTTP/%s" %d',
                     ("127.0.0.1:5000", "GET", "/api/realtime?x=1&ticket=SeCrEt-_9&y=2", "1.1", 101))
    assert QuerySecretFilter().filter(record)
    line = AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False).format(record)
    assert "SeCrEt" not in line
    assert "/api/realtime?x=1&ticket=[redacted]&y=2" in line


def test_redaction_of_websocket_lines_and_plain_messages(uvicorn_loggers):
    from app.core.logging_setup import QuerySecretFilter, redact_query_secrets

    record = _record("uvicorn.error", '%s - "WebSocket %s" [accepted]', ("127.0.0.1:5000", "/api/realtime?ticket=abc"))
    QuerySecretFilter().filter(record)
    assert record.getMessage() == '127.0.0.1:5000 - "WebSocket /api/realtime?ticket=[redacted]" [accepted]'
    record = _record("uvicorn.error", "< GET /api/realtime?TICKET=abc%2Fdef HTTP/1.1", None)
    QuerySecretFilter().filter(record)
    assert "abc" not in record.getMessage()
    assert redact_query_secrets("/api/realtime?ticket=") == "/api/realtime?ticket="  # nothing to hide
    assert redact_query_secrets("/api/x?subticket_id=1") == "/api/x?subticket_id=1"


def test_redaction_survives_uvicorn_dictconfig_and_is_idempotent(uvicorn_loggers):
    import logging.config

    from uvicorn.config import LOGGING_CONFIG

    from app.core.logging_setup import QuerySecretFilter, install_query_redaction

    install_query_redaction()
    install_query_redaction()
    logging.config.dictConfig(LOGGING_CONFIG)
    for name in ("uvicorn.access", "uvicorn.error"):
        assert sum(isinstance(f, QuerySecretFilter) for f in logging.getLogger(name).filters) == 1


async def test_real_uvicorn_never_prints_the_ticket(tmp_path, capfd, uvicorn_loggers):
    """End to end in uvicorn's real order: its dictConfig, then the app factory (create_app)."""
    import asyncio
    import socket

    import httpx
    import uvicorn
    import websockets
    from uvicorn.config import LOGGING_CONFIG

    from app.main import create_app
    from tests.conftest import make_settings

    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'u.db'}")
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    config = uvicorn.Config(lambda: create_app(settings), factory=True, log_config=LOGGING_CONFIG,
                            log_level="debug", access_log=True)
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        async with asyncio.timeout(10):
            while not server.started:
                await asyncio.sleep(0.02)
            async with httpx.AsyncClient() as client:
                await client.get(f"http://127.0.0.1:{port}/up?ticket=HttpSecret123")
            async with websockets.connect(f"ws://127.0.0.1:{port}/api/realtime?ticket=WsSecret456") as ws:
                with pytest.raises(websockets.ConnectionClosed) as closed:
                    await ws.recv()
            assert closed.value.rcvd.code == 4003
    finally:
        server.should_exit = True
        await task
        sock.close()
    out, err = capfd.readouterr()
    output = out + err
    assert "/up?ticket=[redacted]" in output
    assert '"WebSocket /api/realtime?ticket=[redacted]" [accepted]' in output
    assert "HttpSecret123" not in output and "WsSecret456" not in output
