"""Doctor findings for object storage (plan L1 Task 17). Messages name variables, never their values."""
import pytest

from app.admin import doctor
from app.core.config import Settings

SECRETS = ("SECRET-ENDPOINT", "SECRET-BUCKET", "SECRET-AK")


def _facts(**overrides) -> doctor.Facts:
    base = dict(encryption=True, superadmins_without_totp=0, invalid={}, drift=(), pending_restart=(),
                login_alarm=False, db_backend="sqlite", backups=1, missing_prices=(), safe_mode=False)
    base.update(overrides)
    return doctor.Facts(**base)


def _codes(findings) -> dict[str, doctor.Finding]:
    return {f.code: f for f in findings}


def test_the_three_storage_codes_are_registered():
    assert {"storage_s3_unreachable", "storage_fallback_active", "storage_backup_not_uploaded"} <= set(doctor.CODES)


def test_an_unreachable_s3_primary_is_an_error_that_names_only_variables():
    settings = Settings(_env_file=None, storage_backend="s3", s3_endpoint="https://SECRET-ENDPOINT.test",
                        s3_bucket="SECRET-BUCKET", s3_access_key="SECRET-AK", s3_secret_key="SECRET-SK")
    findings = _codes(doctor.diagnose(settings, _facts(storage_backend="s3", storage_probe="denied")))
    finding = findings["storage_s3_unreachable"]
    assert finding.level == "error"
    assert set(finding.keys) == {"storage_backend", "s3_endpoint", "s3_bucket", "s3_access_key"}
    text = " ".join([finding.message_zh, *finding.keys])
    assert not any(secret in text for secret in SECRETS)


@pytest.mark.parametrize("probe", ["unreachable", "denied", "no_bucket"])
def test_every_failed_probe_reports_the_same_error(probe):
    settings = Settings(_env_file=None, storage_backend="s3")
    findings = _codes(doctor.diagnose(settings, _facts(storage_backend="s3", storage_probe=probe)))
    assert "storage_s3_unreachable" in findings


def test_a_healthy_or_local_store_reports_nothing_about_storage():
    settings = Settings(_env_file=None)
    for facts in (_facts(storage_backend="s3", storage_probe="ok"), _facts(storage_probe="not_writable")):
        codes = _codes(doctor.diagnose(settings, facts))
        assert not {"storage_s3_unreachable", "storage_fallback_active", "storage_backup_not_uploaded"} & set(codes)


def test_an_active_fallback_warns_with_its_hit_count():
    settings = Settings(_env_file=None, storage_fallback="s3_fallback")
    finding = _codes(doctor.diagnose(settings, _facts(storage_fallback="s3_fallback",
                                                      storage_fallback_hits=7)))["storage_fallback_active"]
    assert finding.level == "warn" and "7" in finding.message_zh and finding.keys == ("storage_fallback",)


def test_a_backup_that_only_exists_locally_warns():
    settings = Settings(_env_file=None, storage_backend="s3")
    finding = _codes(doctor.diagnose(settings, _facts(storage_backend="s3", backup_unsynced=True)))
    assert finding["storage_backup_not_uploaded"].level == "warn"


@pytest.mark.parametrize("storage_backend", ["s3"], indirect=True)
async def test_gather_facts_probes_once_and_lists_no_objects(app, storage_backend, monkeypatch):
    calls = []
    original = app.state.storage.probe

    async def counting_probe():
        calls.append(1)
        return await original()

    monkeypatch.setattr(app.state.storage, "probe", counting_probe)
    async with app.state.sessionmaker() as session:
        facts = await doctor.gather_facts(session, app)
    assert facts.storage_backend == "s3" and facts.storage_probe == "ok"
    assert len(calls) == 1  # one bounded HEAD of the bucket, nothing per object
