from app.core.config import Settings


def test_model_lists_are_split_and_trimmed():
    s = Settings(_env_file=None, llm_models=" gpt-4o , gpt-4o-mini ,", tts_models="openai/tts-1,azure/speech")
    assert s.llm_model_list == ["gpt-4o", "gpt-4o-mini"]
    assert s.tts_model_list == ["openai/tts-1", "azure/speech"]


def test_defaults():
    s = Settings(_env_file=None)
    assert s.registration_mode == "open"
    assert s.default_llm_model in s.llm_model_list
    assert s.rate_limit_per_minute == 10
