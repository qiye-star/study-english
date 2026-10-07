import io
import logging

import pytest

from app.logging_setup import configure_logging
from app.timing import log_timing


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
