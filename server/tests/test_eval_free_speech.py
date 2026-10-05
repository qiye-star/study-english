import json
import sys

import pytest

from scripts.eval_free_speech import (
    CASES_FILE,
    BlockedError,
    Server,
    contains_phrase,
    grammar_hits,
    norm,
    poor_words,
    summarize,
)


def test_norm_ignores_case_punctuation_and_fillers():
    assert norm("Um, I GO to the park… uh") == "i go to the park"
    assert contains_phrase("Yesterday, I go to the park.", "i go")
    assert not contains_phrase("Yesterday I went to the park.", "i go")


def test_poor_words_follow_the_client_rule():
    result = {"detail_result": {"words": [
        {"word": "Think", "pronunciation_assessment": {"accuracy_score": 30, "error_type": "None"}},
        {"word": "so", "pronunciation_assessment": {"accuracy_score": 95, "error_type": "None"}},
        {"word": "um", "pronunciation_assessment": {"accuracy_score": 0, "error_type": "Insertion"}},
        {"word": "now", "pronunciation_assessment": {"accuracy_score": 90, "error_type": "Mispronunciation"}},
    ]}}
    assert poor_words(result) == ["think", "now"]
    assert poor_words({}) == []


def test_grammar_hits_need_an_error_touching_the_marker():
    g = {"has_errors": True, "errors": [{"original": "go", "corrected": "went"}]}
    assert grammar_hits(g, "i go")
    assert not grammar_hits({"has_errors": True, "errors": [{"original": "park", "corrected": "parks"}]}, "i go")
    assert not grammar_hits({"has_errors": False, "errors": []}, "i go")


def test_summary_rates_and_decisions():
    rows = (
        [{"group": "A", "retained": i < 6, "grammar_hit": i < 5} for i in range(10)]
        + [{"group": "B", "false_positive": i < 2} for i in range(10)]
        + [{"group": "C", "transcribed_as_spoken": True, "transcribed_as_intended": False,
            "flagged_vs_transcript": False, "flagged_vs_intended": True}]
    )
    s = summarize(rows)
    assert s["a_retained_rate"] == 0.6 and s["a_detected_rate_overall"] == 0.5
    assert abs(s["a_detected_rate_when_retained"] - 5 / 6) < 1e-9
    assert s["b_false_positive_rate"] == 0.2
    assert s["c_flagged_vs_intended"] == 1.0 and s["c_flagged_vs_transcript"] == 0.0
    assert s["fallback_needed"] is True and s["prompt_review_needed"] is True


def test_decisions_at_the_thresholds_are_not_triggered():
    rows = (
        [{"group": "A", "retained": i < 7, "grammar_hit": True} for i in range(10)]
        + [{"group": "B", "false_positive": i < 1} for i in range(10)]
    )
    s = summarize(rows)
    assert s["fallback_needed"] is False and s["prompt_review_needed"] is False
    assert summarize([])["fallback_needed"] is False


def test_recommendations_name_the_fallback_and_rules_round():
    from scripts.eval_free_speech import recommendations

    both = recommendations({"fallback_needed": True, "prompt_review_needed": True})
    assert any("GRAMMAR_FOR_VOICE" in line for line in both)
    assert any("DEFAULT_GRAMMAR_RULES" in line for line in both)
    none = recommendations({"fallback_needed": False, "prompt_review_needed": False})
    assert not any("GRAMMAR_FOR_VOICE = false" in line for line in none)


def test_cases_file_shape():
    cases = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    assert [len(cases[k]) for k in ("grammar_errors", "correct", "mispronounced")] == [10, 10, 6]
    for c in cases["grammar_errors"]:
        assert contains_phrase(c["spoken"], c["marker"])
    for c in cases["mispronounced"]:
        assert c["substitute"] in c["spoken"].lower() and c["target"] in c["intended"].lower()


class _Resp:
    def __init__(self, status):
        self.status_code = status
        self.content = b"secret-body"

        class _Req:
            method = "POST"

            class url:  # noqa: N801
                path = "/api/ai/audio/transcriptions"

        self.request = _Req


@pytest.mark.parametrize("status", [403, 502, 503])
def test_upstream_failures_are_blocked_without_leaking_the_body(status):
    server = Server("http://unused")
    with pytest.raises(BlockedError) as exc:
        server._checked(_Resp(status))
    msg = str(exc.value)
    assert msg.startswith("BLOCKED: /api/ai/audio/transcriptions " + str(status))
    assert "secret-body" not in msg


def test_other_errors_are_not_blocked():
    server = Server("http://unused")
    with pytest.raises(RuntimeError) as exc:
        server._checked(_Resp(400))
    assert not isinstance(exc.value, BlockedError)


class _JsonResp(_Resp):
    def __init__(self, status, body=None, bad_json=False):
        super().__init__(status)
        self._body, self._bad = body, bad_json

    def json(self):
        if self._bad:
            raise ValueError("invalid json")
        return self._body


def test_safe_error_code_shows_short_server_messages_only():
    from scripts.eval_free_speech import _safe_error_code

    assert _safe_error_code(_JsonResp(502, {"error": "Upstream authentication failed"})) == "Upstream authentication failed"
    assert _safe_error_code(_JsonResp(503, {"detail": "short string"})) == "short string"
    assert _safe_error_code(_JsonResp(502, {"error": "x" * 500})) == "unknown"
    assert _safe_error_code(_JsonResp(502, {"error": "sk-abc\nsecret<script>"})) == "unknown"
    assert _safe_error_code(_JsonResp(502, {"error": {"message": "nested secret"}})) == "unknown"
    assert _safe_error_code(_JsonResp(502, {"detail": [{"msg": "list"}]})) == "unknown"
    assert _safe_error_code(_JsonResp(502, {"code": "AccountOverdueError"})) == "AccountOverdueError"
    assert _safe_error_code(_JsonResp(502, bad_json=True)) == "unknown"
    assert _safe_error_code(_JsonResp(502, ["not", "a", "dict"])) == "unknown"


def test_blocked_line_carries_the_server_message():
    server = Server("http://unused")
    with pytest.raises(BlockedError) as exc:
        server._checked(_JsonResp(502, {"error": "Upstream authentication failed"}))
    assert str(exc.value) == "BLOCKED: /api/ai/audio/transcriptions 502 Upstream authentication failed"


def test_summary_ignores_rows_with_errors():
    rows = [{"group": "A", "retained": True, "grammar_hit": True}, {"group": "A", "error": "empty transcript"},
            {"group": "B", "false_positive": False}, {"group": "B", "error": "empty transcript"}]
    s = summarize(rows)
    assert s["a_total"] == 1 and s["a_retained_rate"] == 1.0 and s["b_total"] == 1


def test_main_refuses_remote_base_url_without_flag(monkeypatch, capsys):
    from scripts import eval_free_speech as m

    monkeypatch.setattr(sys, "argv", ["x", "--base-url", "https://example.com"])
    assert m.main() == 2
    assert "non-loopback" in capsys.readouterr().err


def test_register_reports_a_bad_response_cleanly():
    server = Server("http://unused")
    server.http.post = lambda *a, **k: _JsonResp(200, {"nope": 1})
    with pytest.raises(RuntimeError, match="access_token"):
        server.register()


def test_cache_write_is_atomic(tmp_path, monkeypatch):
    from scripts import eval_free_speech as m

    monkeypatch.setattr(m, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(m, "to_wav", lambda audio, suffix: b"WAV")

    class _S:
        def tts(self, text, voice):
            return b"mp3"

    assert m.cached_wav(_S(), "hello", "v") == b"WAV"
    assert [p.suffix for p in tmp_path.iterdir()] == [".wav"]
    assert m.cached_wav(None, "hello", "v") == b"WAV"  # served from cache, no server needed
