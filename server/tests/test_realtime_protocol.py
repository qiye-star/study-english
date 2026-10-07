import json
import struct

import pytest

from app import realtime_protocol as rp
from app.realtime_protocol import (
    CLOSE_REASONS, MAX_CLIENT_TEXT, MAX_SYSTEM_PROMPT, MAX_UPLINK_FRAME, HangupMsg, InterruptMsg, ProtocolError,
    StartMsg, UtteranceCancelMsg, UtteranceEndMsg, audio_frame, check_uplink, parse_client_message,
)

START = {"type": "start", "voice": "en_female_dacey_uranus_bigtts"}


def test_close_codes_match_the_contract():
    assert CLOSE_REASONS == {
        1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
        4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
    }


def test_close_constants_have_the_contract_values():
    assert (rp.CLOSE_NORMAL, rp.CLOSE_UNAUTHORIZED, rp.CLOSE_DISABLED, rp.CLOSE_NOT_FOUND, rp.CLOSE_IDLE) == (
        1000, 4001, 4003, 4004, 4008)
    assert (rp.CLOSE_MAX_DURATION, rp.CLOSE_MESSAGE_LIMIT, rp.CLOSE_BUSY, rp.CLOSE_PROTOCOL, rp.CLOSE_UPSTREAM) == (
        4009, 4013, 4029, 4400, 4502)
    assert (MAX_UPLINK_FRAME, MAX_SYSTEM_PROMPT, MAX_CLIENT_TEXT) == (32000, 8000, 16384)


def test_parse_each_message():
    start = parse_client_message(json.dumps({**START, "system_prompt": "Be kind.", "save_recordings": True}))
    assert isinstance(start, StartMsg) and start.temperature == 0.7 and start.save_recordings is True
    assert isinstance(parse_client_message('{"type":"utterance_end"}'), UtteranceEndMsg)
    assert isinstance(parse_client_message('{"type":"utterance_cancel"}'), UtteranceCancelMsg)
    assert isinstance(parse_client_message('{"type":"interrupt"}'), InterruptMsg)
    assert isinstance(parse_client_message('{"type":"hangup"}'), HangupMsg)


def test_start_defaults():
    start = parse_client_message(json.dumps(START))
    assert (start.system_prompt, start.model, start.temperature, start.language, start.save_recordings) == (
        "", "", 0.7, "en", False)


def test_start_accepts_what_the_web_client_sends():
    # shape of web encodeStart()
    raw = json.dumps({"type": "start", "system_prompt": "Hi", "model": "m", "temperature": 0.5, "voice": "v_1x",
                      "language": "en", "save_recordings": True})
    start = parse_client_message(raw)
    assert start.voice == "v_1x" and start.model == "m" and start.temperature == 0.5


@pytest.mark.parametrize("fields", [
    {"system_prompt": "x" * MAX_SYSTEM_PROMPT},
    {"system_prompt": "你" * MAX_SYSTEM_PROMPT},
    {"model": "m" * 200},
    {"temperature": 0}, {"temperature": 2}, {"temperature": 2.0}, {"temperature": 1},
    {"voice": "abc"}, {"voice": "a" * 100},
    {"language": "en"}, {"language": "zh-CN"}, {"language": "pt-br"},
])
def test_boundary_values_are_accepted(fields):
    # JSON.stringify in the browser does not escape non-ASCII
    assert isinstance(parse_client_message(json.dumps({**START, **fields}, ensure_ascii=False)), StartMsg)


@pytest.mark.parametrize("raw", [
    "not json",
    "",
    "null", "[]", "1", '"start"', "true",
    "{}",
    '{"type":"dance"}',
    '{"type":"Start","voice":"abcd"}',
    '{"type":null}',
    '{"type":1}',
    '{"type":["hangup"]}',
    '{"type":"hangup","extra":1}',
    '{"type":"interrupt","extra":null}',
    '{"type":"utterance_end","type2":"x"}',
    '{"type":"start"}',  # voice is required
    json.dumps({**START, "extra": 1}),
    json.dumps({**START, "voice": "bad voice!"}),
    json.dumps({**START, "voice": "ab"}),
    json.dumps({**START, "voice": "a" * 101}),
    json.dumps({**START, "voice": "abcd\n"}),
    json.dumps({**START, "voice": ""}),
    json.dumps({**START, "voice": None}),
    json.dumps({**START, "voice": 123456}),
    json.dumps({**START, "system_prompt": "x" * 8001}),
    json.dumps({**START, "system_prompt": None}),
    json.dumps({**START, "system_prompt": 5}),
    json.dumps({**START, "model": "m" * 201}),
    json.dumps({**START, "model": ["m"]}),
    json.dumps({**START, "temperature": 3}),
    json.dumps({**START, "temperature": -0.1}),
    json.dumps({**START, "temperature": 2.01}),
    json.dumps({**START, "temperature": "0.5"}),
    json.dumps({**START, "temperature": True}),
    json.dumps({**START, "temperature": None}),
    '{"type":"start","voice":"abcd","temperature":NaN}',
    '{"type":"start","voice":"abcd","temperature":Infinity}',
    '{"type":"start","voice":"abcd","temperature":-Infinity}',
    json.dumps({**START, "language": "english"}),
    json.dumps({**START, "language": "EN"}),
    json.dumps({**START, "language": "e"}),
    json.dumps({**START, "language": "en-"}),
    json.dumps({**START, "language": "en-USA"}),
    json.dumps({**START, "language": ""}),
    json.dumps({**START, "save_recordings": "true"}),
    json.dumps({**START, "save_recordings": 1}),
    json.dumps({**START, "save_recordings": None}),
    "x" * 20000,
    " " * (MAX_CLIENT_TEXT + 1) + '{"type":"hangup"}',
    "[" * 10000 + "]" * 10000,
    '{"type":"hangup"} trailing',
    '{"type":"hangup"}{"type":"hangup"}',
])
def test_invalid_messages_raise(raw):
    with pytest.raises(ProtocolError):
        parse_client_message(raw)


@pytest.mark.parametrize("raw", [b'{"type":"hangup"}', None, 5, ["hangup"], {"type": "hangup"}])
def test_non_text_input_is_a_protocol_error(raw):
    with pytest.raises(ProtocolError):
        parse_client_message(raw)  # type: ignore[arg-type]


def test_duplicate_keys_and_lone_surrogates_do_not_escape_as_other_errors():
    for raw in ['{"type":"hangup","type":"hangup","x":1}', '{"type":"start","voice":"abcd","model":"\ud800"}']:
        try:
            parse_client_message(raw)
        except ProtocolError:
            pass


def test_max_size_message_is_parsed_not_rejected_for_size():
    raw = json.dumps({**START, "system_prompt": "x" * MAX_SYSTEM_PROMPT})
    assert len(raw) <= MAX_CLIENT_TEXT
    parse_client_message(raw)
    with pytest.raises(ProtocolError, match="too large"):
        parse_client_message(raw + " " * MAX_CLIENT_TEXT)


def test_protocol_error_hides_input():
    secret = "SUPER-SECRET-TEXT"
    with pytest.raises(ProtocolError) as exc:
        parse_client_message(json.dumps({**START, "system_prompt": secret, "temperature": 9}))
    assert secret not in str(exc.value) and exc.value.__cause__ is None


def test_uplink_frames_are_bounded_pcm16():
    check_uplink(b"\x00\x00" * 160)
    check_uplink(b"\x00\x00")
    check_uplink(b"\x00" * MAX_UPLINK_FRAME)
    for bad in (b"", b"\x00", b"\x00" * 3, b"\x00" * (MAX_UPLINK_FRAME + 1), b"\x00" * (MAX_UPLINK_FRAME + 2)):
        with pytest.raises(ProtocolError):
            check_uplink(bad)


@pytest.mark.parametrize("bad", [None, "ab", 5])
def test_uplink_rejects_non_bytes(bad):
    with pytest.raises(ProtocolError):
        check_uplink(bad)  # type: ignore[arg-type]


def test_uplink_accepts_bytearray_and_memoryview():
    check_uplink(bytearray(b"\x00\x00"))
    check_uplink(memoryview(b"\x00\x00"))


def test_audio_frame_prefixes_the_turn_id():
    frame = audio_frame(258, b"\x01\x02")
    assert struct.unpack(">I", frame[:4])[0] == 258 and frame[4:] == b"\x01\x02"
    assert frame[:4] == b"\x00\x00\x01\x02"


def test_audio_frame_turn_id_bounds_and_pcm_alignment():
    assert audio_frame(0, b"")[:4] == b"\x00\x00\x00\x00"
    assert audio_frame(2**32 - 1, b"\x00\x00")[:4] == b"\xff\xff\xff\xff"
    for bad_id in (-1, 2**32, 1.5, True, "1", None):
        with pytest.raises(ValueError):
            audio_frame(bad_id, b"\x00\x00")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        audio_frame(1, b"\x00")
