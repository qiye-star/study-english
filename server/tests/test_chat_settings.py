from tests.conftest import make_settings


def test_grammar_defaults_follow_the_llm_upstream():
    s = make_settings()
    assert s.resolved_grammar_model == "gpt-4o"
    assert s.grammar_upstream == ("https://llm.test/v1", "llm-secret")
    assert s.max_practice_items == 500
    assert s.grammar_prompt == "" and s.grammar_prompt_file == ""


def test_grammar_model_and_separate_upstream():
    s = make_settings(grammar_model=" grammar-mini ", upstream_grammar_base_url="https://grammar.test/v1",
                      upstream_grammar_key="g-secret")
    assert s.resolved_grammar_model == "grammar-mini"
    assert s.grammar_upstream == ("https://grammar.test/v1", "g-secret")


def test_separate_upstream_never_borrows_the_llm_key():
    s = make_settings(upstream_grammar_base_url="https://grammar.test/v1")
    assert s.grammar_upstream == ("https://grammar.test/v1", "")


def test_vocabulary_limit_setting():
    assert make_settings().max_vocab_items == 2000
    assert make_settings(max_vocab_items=5).max_vocab_items == 5
