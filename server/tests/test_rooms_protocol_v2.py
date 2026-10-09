import pytest

from app.rooms.protocol import (
    ACTIVITY_STATES, ERROR_CODES, NOTICE_CODES, PROTOCOL_VERSION, REACTION_KEYS, SERVER_EVENT_TYPES, HelloMsg,
    ProtocolError, ReactMsg, SayMsg, TypingMsg, VoiceRetryMsg, VoiceTranslateMsg, parse_client_message,
)


def test_v1_frames_still_parse_and_v2_adds_fields():
    hello = parse_client_message('{"type":"hello","last_seq":3}')
    assert isinstance(hello, HelloMsg) and hello.v == 1
    assert parse_client_message('{"type":"hello","last_seq":3,"v":2}').v == 2
    say = parse_client_message('{"type":"say","client_id":"c1","text":"hi"}')
    assert isinstance(say, SayMsg) and say.reply_to is None
    assert parse_client_message('{"type":"say","client_id":"c1","text":"hi","reply_to":5}').reply_to == 5


@pytest.mark.parametrize("raw,cls", [
    ('{"type":"typing","state":"recording"}', TypingMsg),
    ('{"type":"react","seq":4,"key":"like","on":true}', ReactMsg),
    ('{"type":"voice_translate","seq":4}', VoiceTranslateMsg),
    ('{"type":"voice_retry","seq":4}', VoiceRetryMsg),
])
def test_new_client_messages(raw, cls):
    assert isinstance(parse_client_message(raw), cls)


@pytest.mark.parametrize("raw", [
    '{"type":"react","seq":4,"key":"thumbs_up","on":true}',
    '{"type":"react","seq":0,"key":"like","on":true}',
    '{"type":"react","seq":4,"key":"like","on":1}',
    '{"type":"typing","state":"shouting"}',
    '{"type":"say","client_id":"c1","text":"hi","reply_to":0}',
    '{"type":"say","client_id":"c1","text":"hi","reply_to":2147483648}',
    '{"type":"hello","last_seq":0,"v":3}',
    '{"type":"voice_retry","seq":4,"extra":1}',
])
def test_bad_v2_frames_are_protocol_errors(raw):
    with pytest.raises(ProtocolError):
        parse_client_message(raw)


def test_constants():
    assert PROTOCOL_VERSION == 2
    assert REACTION_KEYS == ("like", "love", "haha", "wow", "clap", "thanks")
    assert all("_" not in k for k in REACTION_KEYS)  # camelcase-keys safety (spec R2-15)
    assert ACTIVITY_STATES == ("typing", "recording", "idle")
    assert {"activity", "reaction", "voice_update", "join_request", "join_request_closed"} <= set(SERVER_EVENT_TYPES)
    assert {"voice_off", "voice_quota", "translate_quota", "retry_limit"} <= set(NOTICE_CODES)
    assert {"bad_reply", "bad_seq"} <= set(ERROR_CODES)
