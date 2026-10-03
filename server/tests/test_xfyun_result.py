import json
from pathlib import Path

import pytest

from app.xfyun_result import ARPABET_TO_IPA, arpabet_to_ipa, normalise_score, to_assessment

FIXTURES = Path(__file__).parent / "fixtures"
IPA_MAPPING = json.loads(
    (Path(__file__).parent.parent / "app" / "static_config" / "ipa_mappings.json").read_text(
        encoding="utf-8"
    )
)
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."


def load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def minimal_xml(word_score="90", dp="0", syll_score="90", phone_dp="0") -> str:
    return (
        "<xml_result><read_sentence><rec_paper>"
        '<read_chapter total_score="50" accuracy_score="50" fluency_score="50" '
        'integrity_score="50" is_rejected="false" reject_type="0">'
        '<sentence><word content="cat" beg_pos="0" end_pos="10" '
        f'dp_message="{dp}" total_score="{word_score}">'
        f'<syll content="k ae t" beg_pos="0" end_pos="10" syll_score="{syll_score}">'
        f'<phone content="k" beg_pos="0" end_pos="5" dp_message="{phone_dp}"/>'
        "</syll></word></sentence></read_chapter></rec_paper></read_sentence></xml_result>"
    )


def first_word(xml: str) -> dict:
    return to_assessment(xml, "cat")["detail_result"]["words"][0]


def test_good_scores():
    result = to_assessment(load("ise_good.xml"), REFERENCE)
    assert result["pronunciation_score"] == pytest.approx(98.87, abs=0.01)
    assert result["accuracy_score"] == pytest.approx(99.54, abs=0.01)
    assert result["fluency_score"] == pytest.approx(97.14, abs=0.01)
    assert result["completeness_score"] == 100.0
    assert "prosody_score" not in result
    detail = result["detail_result"]
    assert detail["display"] == REFERENCE
    assert detail["lexical"].startswith("hello nice to meet you")
    assert detail["rejected"] is False
    assert detail["pronunciation_assessment"]["pron_score"] == result["pronunciation_score"]


def test_words_shape():
    words = to_assessment(load("ise_good.xml"), REFERENCE)["detail_result"]["words"]
    assert len(words) == 13
    assert words[0]["word"] == "hello"
    assert words[-1]["word"] == "please"
    assert "sil" not in [w["word"] for w in words]
    hello = words[0]
    assert hello["offset"] == 1 * 100000
    assert hello["duration"] == 53 * 100000
    assert hello["pronunciation_assessment"]["error_type"] == "None"
    assert [p["phoneme"] for p in hello["phonemes"]] == ["h", "ɛ", "l", "oʊ"]
    assert len(hello["syllables"]) == 2
    for word in words:
        for ph in word["phonemes"]:
            assert isinstance(ph["offset"], int)
            assert isinstance(ph["duration"], int)
            assert 0 <= ph["pronunciation_assessment"]["accuracy_score"] <= 100


def test_mismatch():
    result = to_assessment(load("ise_mismatch.xml"), REFERENCE)
    assert result["completeness_score"] < 10
    assert result["pronunciation_score"] < 5
    assert result["detail_result"]["rejected"] is True
    omitted = [
        w
        for w in result["detail_result"]["words"]
        if w["pronunciation_assessment"]["error_type"] == "Omission"
    ]
    assert len(omitted) >= 8
    for word in omitted:
        assert all(p["pronunciation_assessment"]["accuracy_score"] == 0 for p in word["phonemes"])


@pytest.mark.parametrize(
    "dp,score,expected",
    [
        ("0", "40", "Mispronunciation"),
        ("128", "90", "Mispronunciation"),
        ("32", "90", "Insertion"),
        ("64", "90", "Insertion"),
        ("16", "0", "Omission"),
        ("0", "60", "None"),
    ],
)
def test_error_types(dp, score, expected):
    word = first_word(minimal_xml(word_score=score, dp=dp))
    assert word["pronunciation_assessment"]["error_type"] == expected


def test_phoneme_accuracy_is_min_of_word_and_syllable():
    def phoneme_score(word_score, syll_score):
        word = first_word(minimal_xml(word_score=word_score, syll_score=syll_score))
        return word["phonemes"][0]["pronunciation_assessment"]["accuracy_score"]

    assert phoneme_score("90", "70") == 70
    assert phoneme_score("60", "95") == 60


def test_phoneme_with_dp_message_scores_zero():
    word = first_word(minimal_xml(phone_dp="128"))
    assert word["phonemes"][0]["pronunciation_assessment"]["accuracy_score"] == 0


def test_all_ipa_symbols_exist_in_client_mapping():
    for name in ("ise_good.xml", "ise_mismatch.xml"):
        words = to_assessment(load(name), REFERENCE)["detail_result"]["words"]
        for word in words:
            for ph in word["phonemes"]:
                assert ph["phoneme"] in IPA_MAPPING, ph["phoneme"]
    for ipa in ARPABET_TO_IPA.values():
        assert ipa in IPA_MAPPING, ipa


def test_arpabet_helpers():
    assert arpabet_to_ipa("ow") == "oʊ"
    assert arpabet_to_ipa("'l") == "l"
    assert arpabet_to_ipa("zzz") == "zzz"


def test_invalid_xml_raises_value_error():
    with pytest.raises(ValueError):
        to_assessment("<not xml", "x")
    with pytest.raises(ValueError):
        to_assessment("<xml_result/>", "x")


def test_scores_clamped_and_rounded():
    assert normalise_score(100.0049) == 100.0
    assert normalise_score(-0.1) == 0.0
    assert normalise_score(12.3456) == 12.35
