from app.core.config import Settings
from app.core.settings_registry import (
    ENV_ONLY, GROUPS, SECRETS, SPECS, choices_for, effective_bounds, env_name, field_bounds, spec_for,
)

EXPECTED_ENV_ONLY = {
    "database_url", "data_dir", "web_dist_dir", "admin_dist_dir", "backup_dir", "admin_username", "admin_password",
    "admin_totp_secret", "admin_session_secret", "settings_encryption_key", "admin_settings_safe_mode",
    "admin_ip_allowlist", "admin_cookie_secure", "trust_proxy_headers", "grammar_prompt_file", "build_sha",
    "wordbook_data_dir",  # spec 2026-10-10-wordbook §10
}
EXPECTED_SECRETS = {
    "database_url", "invite_code", "upstream_llm_key", "upstream_tts_key", "upstream_whisper_key", "upstream_grammar_key",
    "volcengine_tts_key", "volcengine_asr_key", "azure_speech_key", "xfyun_api_key", "xfyun_api_secret",
    "admin_password", "admin_session_secret", "admin_totp_secret", "settings_encryption_key",
}


def test_every_settings_field_has_exactly_one_spec():
    assert set(SPECS) == set(Settings.model_fields)


def test_env_only_and_secret_sets_match_the_spec_document():
    assert ENV_ONLY == EXPECTED_ENV_ONLY
    assert SECRETS == EXPECTED_SECRETS
    assert all(SPECS[k].kind == "secret" for k in SECRETS)


def test_groups_are_known_and_env_names_are_upper_case():
    known = {g for g, _ in GROUPS}
    assert all(s.group in known for s in SPECS.values())
    assert env_name("rate_limit_per_minute") == "RATE_LIMIT_PER_MINUTE"


def test_registry_bounds_never_loosen_field_bounds():
    for key, spec in SPECS.items():
        lo, hi = field_bounds(key)
        elo, ehi = effective_bounds(spec)
        if lo is not None:
            assert elo is not None and elo >= lo, key
        if hi is not None:
            assert ehi is not None and ehi <= hi, key


def test_choices_come_from_literals():
    assert choices_for("registration_mode") == ("open", "invite", "closed")
    assert choices_for("maintenance_mode") == ("off", "read_only", "full")
    assert spec_for("registration_mode").kind == "enum"


def test_pairs_point_at_secret_keys_and_rank_keys_are_managed():
    for spec in SPECS.values():
        if spec.pair:
            assert SPECS[spec.pair].secret, spec.key
    managed = {k for k, s in SPECS.items() if s.managed_by == "rank_rules"}
    assert managed == {"rank_daily_rp_cap", "rank_match_daily_attempts", "rank_match_cooldown_minutes",
                       "rank_match_minutes", "rank_season_anchor", "rank_season_weeks"}


def test_restart_keys():
    assert {k for k, s in SPECS.items() if s.apply == "restart" and not s.env_only} == {
        "asr_stream_max_concurrency", "rooms_ai_concurrency", "rooms_voice_concurrency"}


def test_new_v2_defaults():
    s = Settings(_env_file=None)
    assert (s.maintenance_mode, s.admin_cookie_secure, s.admin_idle_minutes, s.backup_hour_utc) == ("off", True, 30, -1)
    assert Settings(_env_file=None, admin_ip_allowlist="10.0.0.0/8, 192.168.1.5").admin_ip_networks[1].num_addresses == 1


def test_learning_links_settings():
    s = Settings(_env_file=None)
    assert s.links_enabled is False
    flags = [k for k in Settings.model_fields if k.startswith("link_") and k.endswith("_enabled")]
    assert sorted(flags) == sorted(["link_word_actions_enabled", "link_daily_tasks_enabled", "link_mistakes_enabled",
                                    "link_pron_shadow_enabled", "link_chat_words_enabled", "link_rank_sources_enabled",
                                    "link_chat_words_llm_enabled"])
    assert all(getattr(s, k) is (k != "link_chat_words_llm_enabled") for k in flags)
    links = {k for k, spec in SPECS.items() if spec.group == "links"}
    assert links == {k for k in Settings.model_fields if k.startswith(("links_", "link_"))}
    assert all(SPECS[k].apply == "hot" for k in links)
    assert SPECS["link_chat_words_llm_enabled"].danger and SPECS["link_chat_words_llm_global_daily"].danger
    assert ("links", "学习联动") in GROUPS
    assert (s.links_queue_max, s.links_handler_timeout_ms, s.links_breaker_failures,
            s.links_breaker_cooldown_seconds, s.links_retention_days, s.link_chat_words_daily_max,
            s.link_chat_words_llm_global_daily) == (1000, 2000, 5, 60, 90, 10, 200)