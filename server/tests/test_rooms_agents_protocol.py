import pytest

from app.rooms.protocol import (
    AI_FAILED_CODES, MAX_AGENTS, NOTICE_CODES, PROTOCOL_VERSION, SERVER_EVENT_TYPES, TUTOR_TURN_SECONDS, ProtocolError,
    event, parse_client_message,
)


def test_agent_events_are_additive():
    # the reopen lane's `reopened` stays right before ours (INDEX X16)
    assert SERVER_EVENT_TYPES[-4:] == ("reopened", "agent_step", "agent_thought", "agent_tutor")
    assert SERVER_EVENT_TYPES[:4] == ("welcome", "message", "ack", "presence")  # nothing before them moved
    assert NOTICE_CODES[-1] == "agent_off" and AI_FAILED_CODES == ("upstream", "quota", "restart")
    assert (MAX_AGENTS, TUTOR_TURN_SECONDS, PROTOCOL_VERSION) == (2, 60, 2)
    assert event("agent_tutor", tutor=None) == {"type": "agent_tutor", "tutor": None}


def test_no_new_client_frames():
    with pytest.raises(ProtocolError):
        parse_client_message('{"type":"agent_step"}')
