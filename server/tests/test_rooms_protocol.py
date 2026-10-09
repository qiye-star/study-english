import json

import pytest

from app.rooms.protocol import (
    MAX_CLIENT_TEXT, SERVER_EVENT_TYPES, AssistMsg, HelloMsg, PingMsg, ProtocolError, SayMsg, event,
    parse_client_message,
)


def test_parses_each_client_message():
    assert parse_client_message('{"type":"hello","last_seq":0}') == HelloMsg(type="hello", last_seq=0)
    say = parse_client_message('{"type":"say","client_id":"c1","text":"hi","assist_id":null}')
    assert isinstance(say, SayMsg) and say.assist_id is None
    assert isinstance(parse_client_message('{"type":"assist","request_id":"r1","text":"I like 巧克力"}'), AssistMsg)
    assert isinstance(parse_client_message('{"type":"ping"}'), PingMsg)


@pytest.mark.parametrize("raw", [
    "not json", "[]", '{"type":"nope"}', '{"type":"hello","last_seq":-1}', '{"type":"hello","last_seq":"1"}',
    '{"type":"say","client_id":"","text":"hi"}', '{"type":"say","client_id":"c","text":""}',
    '{"type":"say","client_id":"c","text":"hi","extra":1}', '{"type":"assist","request_id":"r","text":"' + "a" * 501 + '"}',
])
def test_rejects_invalid(raw):
    with pytest.raises(ProtocolError):
        parse_client_message(raw)


def test_rejects_oversized_frames():
    with pytest.raises(ProtocolError):
        parse_client_message('{"type":"ping","pad":"' + "x" * MAX_CLIENT_TEXT + '"}')


def test_event_builder_only_accepts_known_types():
    assert event("ack", client_id="c1", seq=3) == {"type": "ack", "client_id": "c1", "seq": 3}
    assert "assist_reply" in SERVER_EVENT_TYPES
    with pytest.raises(ValueError):
        event("bogus")


def test_contract_fixtures_are_valid_json():
    from pathlib import Path
    root = Path(__file__).parent / "fixtures"
    rank = json.loads((root / "rank_contract.json").read_text(encoding="utf-8"))
    assert set(rank) == {"config", "me", "achievements", "match", "turn", "finish_pass", "finish_fail"}
    mentions = json.loads((root / "room_mentions.json").read_text(encoding="utf-8"))
    assert all(set(case) == {"text", "ai", "question"} for case in mentions)
