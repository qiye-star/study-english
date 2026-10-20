"""运行时设置的业务层(spec §3.4–3.8)。所有修改在一个事务里:覆盖行 + 修订 + 修订号 + 审计;提交后发布。
密钥:加密存储,读出只给 {set, source, fp};审计与修订列表同样只见指纹/“已更改”。"""
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import quote, urlsplit

from sqlalchemy import delete, select

from app.admin import audit, sessions
from app.admin.audit import Actor
from app.core.config import Settings
from app.core.runtime_settings import (
    OverrideError, bump_revision, coerce, compose, load_overrides, read_revisions, runtime_problems,
)
from app.core.secretbox import SecretBoxError, box_for, fingerprint
from app.core.settings_registry import GROUPS, SPECS, choices_for, effective_bounds, env_name
from app.models import RankRuleSet, SettingOverride, SettingRevision, iso_utc

EXPORT_FORMAT, EXPORT_VERSION = "enjoy-admin-settings", 1
MIN_REASON = 4


class SettingsError(Exception):
    def __init__(self, status: int, error: str, fields: dict | None = None, details: dict | None = None):
        super().__init__(error)
        self.status, self.error, self.fields, self.details = status, error, fields, details


@dataclass(frozen=True)
class SaveResult:
    revision: int
    changed: list[str]
    pending_restart: list[str]
    apply_errors: list[str]


DEFAULT_PORTS = {"http": 80, "ws": 80, "https": 443, "wss": 443}
# Non-URL settings that form the host their paired key is sent to (review M2).
# The SMTP host and port decide where `smtp_password` is sent (plan A2b). The host is percent-encoded so that
# `host@other`, `host:25` or `host/x` compare as a different endpoint instead of being parsed as userinfo/port/path;
# the port gets a fixed placeholder host so only the port number differs.
HOST_FORMING = {
    "azure_speech_region": lambda region: f"https://{region}.api.cognitive.microsoft.com/",
    "smtp_host": lambda host: f"smtp://{quote(str(host).strip(), safe='')}",
    "smtp_port": lambda port: f"smtp://smtp-port:{port}",
}


def host_of(url: str) -> str:
    try:
        return (urlsplit(url or "").hostname or "").lower()
    except ValueError:
        return ""


def keyed_endpoint(key: str) -> bool:
    """Settings whose value decides where a key is sent: every `url` setting and the host-forming ones."""
    return SPECS[key].kind == "url" or key in HOST_FORMING


def url_for(key: str, value) -> str:
    if key in HOST_FORMING:
        return HOST_FORMING[key](value) if value else ""
    return str(value or "")


def endpoint_of(key: str, value) -> tuple[str, str, int | None]:
    """(scheme, host, port) the key would travel to: a scheme (TLS -> plain) or port change counts as a new
    endpoint, not only a new host (review m5)."""
    try:
        parts = urlsplit(url_for(key, value))
        scheme = parts.scheme.lower()
        return scheme, (parts.hostname or "").lower(), parts.port or DEFAULT_PORTS.get(scheme)
    except ValueError:
        return "", "", None


def _jsonable(value):
    return value.isoformat() if isinstance(value, date) else value


# Raising these above the threshold is dangerous even though the registry has no danger text for every one.
_THRESHOLD_UP = {"ai_rate_limit_per_minute": 600, "realtime_max_sessions": 20}
_THRESHOLD_TEXT = "调高会增加上游费用"


def _up(old, new) -> bool:
    return isinstance(new, int) and isinstance(old, int) and new > old


def danger_reasons(key: str, old, new) -> list[str]:
    spec = SPECS[key]
    if old == new:
        return []
    if key in _THRESHOLD_UP:
        return [spec.danger or _THRESHOLD_TEXT] if isinstance(new, int) and new > _THRESHOLD_UP[key] else []
    if not spec.danger:
        return []
    if keyed_endpoint(key):
        return [spec.danger] if endpoint_of(key, old) != endpoint_of(key, new) else []
    rules = {
        "registration_mode": new == "open",
        "log_level": new == "DEBUG",
        "maintenance_mode": new != "off",
        "room_message_retention_days": isinstance(new, int) and new > 0,
        "realtime_enabled": new is True,
        "admin_require_totp": new is True,
        "rank_matches_global_daily": _up(old, new),
        "rooms_ai_global_daily": _up(old, new),
        "agents_enabled": new is True,
        "agents_turns_global_daily": _up(old, new),
        # security settings: only the weakening direction is dangerous (review security m1)
        "rate_limit_per_minute": _up(old, new),
        "admin_lockout_threshold": _up(old, new),
        "admin_lockout_minutes": _up(new, old),
        "admin_step_up_minutes": _up(old, new),
        "admin_idle_minutes": _up(old, new),
        "admin_token_ttl_minutes": _up(old, new),
        "admin_audit_retention_days": _up(new, old),
        # captcha: every change of the mode asks; the cost and counter ceilings only when lowered, the login failure
        # threshold only when raised (the weakening direction; spec §9, plan A2)
        "captcha_mode": True,
        "captcha_cost": _up(new, old),
        "captcha_counter_max": _up(new, old),
        "captcha_login_failures": _up(old, new),
        "captcha_ttl_seconds": _up(old, new),
        "captcha_challenges_per_minute": _up(old, new),
        "captcha_flagged_multiplier": _up(new, old),
        "captcha_login_window_minutes": _up(new, old),
    }
    return [spec.danger] if rules.get(key, True) else []


def confirm_phrase(keys: list[str]) -> str:
    return env_name(keys[0]).upper() if len(keys) == 1 else "CONFIRM"


def _pair_value(current: Settings, pair: str) -> str:
    if pair == "volcengine_asr_key":
        return current.asr_stream_key  # empty ASR key falls back to the TTS key
    return getattr(current, pair) or ""


def pair_violations(changes: dict, current: Settings) -> list[str]:
    """Endpoint settings (URLs and host-forming ones such as the Azure region) whose scheme/host/port changes while
    their paired key stays: the existing key would go to the new endpoint."""
    out = []
    for key, value in changes.items():
        spec = SPECS[key]
        if not keyed_endpoint(key) or not spec.pair or value is None:
            continue
        new = endpoint_of(key, value)
        if new[1] and new != endpoint_of(key, getattr(current, key)) and spec.pair not in changes                 and _pair_value(current, spec.pair):
            out.append(key)
    return out


def pair_hosts(changes: dict, keys: list[str]) -> dict[str, str]:
    return {k: host_of(url_for(k, changes[k])) for k in keys}


# Spec §5.4: the season config is read-only once season 1 has begun (also without published rank rules).
SEASON_KEYS = ("rank_season_anchor", "rank_season_weeks")


def season_started(current: Settings) -> bool:
    return datetime.now(timezone.utc).date() >= current.rank_season_anchor


# After a rank rules publish these six settings are read-only; the admin UI shows the same hint in Chinese.
MANAGED_HINT = "Managed by the published rank rules; change it in the rank rules editor (/rank/rules)"


async def rank_rules_managed(session) -> bool:
    return bool(await session.scalar(select(RankRuleSet.id).where(RankRuleSet.status == "published").limit(1)))


def _encode(key: str, value, box) -> tuple[str, bool]:
    if SPECS[key].secret:
        return box.encrypt(str(value)), True
    return json.dumps(_jsonable(value)), False


def _fp(app, value) -> str:
    return fingerprint(app.state.admin_secret, "" if value is None else str(_jsonable(value)))


async def _rows(session) -> dict[str, SettingOverride]:
    return {r.key: r for r in (await session.scalars(select(SettingOverride))).all()}


async def _current_overrides(session, app, box) -> dict[str, object]:
    """Stored overrides that are usable now (decryptable, coercible and not flagged invalid by the last load)."""
    values, _ = await load_overrides(session, box)
    invalid = app.state.settings_hub.invalid
    return {k: v for k, v in values.items() if k not in invalid}


async def save(session, app, actor: Actor, changes: dict, *, reason: str = "", confirm=None, confirm_pairs=(),
               stepped_up: bool = False, action: str = "settings.update", actor_totp: bool = True) -> SaveResult:
    """`actor_totp`: whether the acting admin has TOTP bound; switching ADMIN_REQUIRE_TOTP on needs it (spec §3.2),
    on every path that ends here (PATCH, reset, revert, import; review correctness m10)."""
    if not changes:
        raise SettingsError(400, "No changes")
    await sessions.ensure_secret(app)  # env fingerprints (`_fp`) use the stable admin secret
    base: Settings = app.state.base_settings
    hub = app.state.settings_hub
    box = box_for(base)
    managed = await rank_rules_managed(session)
    for key in changes:
        spec = SPECS.get(key)
        if spec is None:
            raise SettingsError(400, "Unknown setting", fields={key[:64]: "Unknown setting"})
        if spec.env_only:
            raise SettingsError(400, "Setting is read-only", fields={key: "Setting is read-only"})
        if spec.managed_by == "rank_rules" and managed:
            raise SettingsError(409, "Managed by rank rules", fields={key: MANAGED_HINT})
        if spec.secret and changes[key] is not None and box is None:
            raise SettingsError(409, "Encryption key not configured")
    current_values = await _current_overrides(session, app, box)
    rows = await _rows(session)
    merged = dict(current_values)
    fields: dict[str, str] = {}
    for key, value in changes.items():
        if value is None:
            merged.pop(key, None)
            continue
        try:
            merged[key] = coerce(SPECS[key], value)
        except OverrideError as exc:
            fields.update(exc.fields)
    if fields:
        raise SettingsError(422, "Invalid settings", fields=fields)
    try:
        new = compose(base, merged)
    except OverrideError as exc:
        raise SettingsError(422, "Invalid settings", fields=exc.fields) from None
    problems = runtime_problems(new)
    if problems:
        raise SettingsError(422, "Invalid settings", fields={"_": "; ".join(problems)})
    current: Settings = app.state.settings
    if any(k in changes and getattr(new, k) != getattr(current, k) for k in SEASON_KEYS) and season_started(current):
        raise SettingsError(409, "Season locked", fields={k: "Season locked" for k in SEASON_KEYS if k in changes})
    if new.admin_require_totp and not current.admin_require_totp and not actor_totp:
        raise SettingsError(409, "Bind TOTP first", fields={"admin_require_totp": "Bind TOTP first"})
    # A restart key's stored value may differ from the running one (pending): setting it back is a real change.
    changed = [k for k in changes
               if getattr(new, k) != getattr(current, k) or (changes[k] is None) != (k not in rows)
               or k in hub.pending_restart]
    if not changed:
        raise SettingsError(409, "Nothing to change")
    danger = {k: r for k in changed if (r := danger_reasons(k, getattr(current, k), getattr(new, k)))}
    if danger:
        if not stepped_up:
            raise SettingsError(403, "Step-up required")
        phrase = confirm_phrase(sorted(danger))
        if len(reason.strip()) < MIN_REASON or (confirm or "").strip() != phrase:
            raise SettingsError(409, "Confirmation required", details={"confirm": phrase, "danger": danger})
    pairs = [k for k in pair_violations({k: changes[k] for k in changed}, current) if k not in set(confirm_pairs)]
    if pairs:
        raise SettingsError(409, "Key would be sent to a new host",
                            details={"pairs": pairs, "hosts": pair_hosts(changes, pairs)})
    if not hub.safe_mode:
        try:
            hub.prepare(new)  # listener pre-checks (e.g. grammar rules reload)
        except OverrideError as exc:
            raise SettingsError(422, "Invalid settings", fields=exc.fields) from None
    revision_row = SettingRevision(actor=actor.name[:64], reason=reason[:200], changes=[])
    session.add(revision_row)
    await session.flush()
    log, before, after = [], {}, {}
    now = datetime.now(timezone.utc)
    for key in changed:
        old_row = rows.get(key)
        if old_row is None:
            old = {"source": "env"}
        elif old_row.secret:
            old = {"source": "override", "enc": old_row.value}
        else:
            old = {"source": "override", "value": json.loads(old_row.value)}
        if changes[key] is None:
            await session.execute(delete(SettingOverride).where(SettingOverride.key == key))
            new_entry = {"source": "env"}
        else:
            value, secret = _encode(key, merged[key], box)
            row = old_row or SettingOverride(key=key)
            row.value, row.secret, row.revision, row.updated_at, row.updated_by = \
                value, secret, revision_row.id, now, actor.name[:64]
            row.env_fp = _fp(app, getattr(base, key))
            session.add(row)
            new_entry = {"source": "override", **({"enc": value} if secret else {"value": json.loads(value)})}
        log.append({"key": key, "op": "reset" if changes[key] is None else "set", "old": old, "new": new_entry})
        before[key] = _jsonable(audit.redact_setting(key, getattr(current, key), _fp(app, getattr(current, key))))
        after[key] = _jsonable(audit.redact_setting(key, getattr(new, key), _fp(app, getattr(new, key))))
    revision_row.changes = log
    await bump_revision(session, "settings")
    await audit.record(session, actor, action, target_type="setting", target_id=",".join(changed)[:64],
                       summary=f"{len(changed)} setting(s)", before=before, after=after, reason=reason or None)
    await session.commit()
    if hub.safe_mode:  # stored, but the process keeps running on env values until safe mode is switched off
        return SaveResult(revision_row.id, changed, [], [])
    hub.invalid = {k: v for k, v in hub.invalid.items() if k not in changed}
    errors = hub.publish(new)
    pending = sorted(k for k in changed if k in hub.pending_restart)
    return SaveResult(revision_row.id, changed, pending, errors)


def _state(app, value, source: str) -> dict:
    return {"set": bool(value), "source": source if value else "none", "fp": _fp(app, value) if value else ""}


def _decrypt(box, token: str) -> str | None:
    if box is None:
        return None
    try:
        return box.decrypt(token)
    except SecretBoxError:
        return None


async def list_settings(session, app, *, role: str = "superadmin") -> dict:
    """`role` below superadmin gets the env-only admin values (emergency username = lockout key, IP allowlist, ...)
    masked (review security m3)."""
    await sessions.ensure_secret(app)
    base: Settings = app.state.base_settings
    current: Settings = app.state.settings
    hub = app.state.settings_hub
    box = box_for(base)
    rows = await _rows(session)
    managed = await rank_rules_managed(session)
    items = []
    for key, spec in SPECS.items():
        lo, hi = effective_bounds(spec)
        row = rows.get(key)
        active = row is not None and key not in hub.invalid and not hub.safe_mode
        env_value = getattr(base, key)
        env_source = "env" if key in base.model_fields_set else "default"
        item = {
            "key": key, "env": env_name(key), "group": spec.group, "kind": spec.kind, "label": spec.label_zh,
            "help": spec.help_zh, "apply": spec.apply, "danger": spec.danger, "env_only": spec.env_only,
            "secret": spec.secret, "managed": spec.managed_by == "rank_rules" and managed, "pair": spec.pair,
            "min": lo, "max": hi, "choices": list(choices_for(key) or []) or None,
            "source": "override" if active else env_source,
            "invalid": hub.invalid.get(key),
            "drift": bool(row is not None and row.env_fp != _fp(app, env_value)),
        }
        if spec.secret:
            override_plain = _decrypt(box, row.value) if row is not None and row.secret else None
            item["env_state"] = _state(app, env_value, "env")
            item["override_state"] = {"set": row is not None, "source": "override" if row is not None else "none",
                                      "fp": _fp(app, override_plain) if override_plain else ""}
            item["effective_state"] = _state(app, getattr(current, key), "override" if active else "env")
            item["pending"] = key in hub.pending_restart
        else:
            item["default"] = _jsonable(Settings.model_fields[key].default)
            item["env_value"] = _jsonable(env_value)
            override = None
            if row is not None and not row.secret:
                try:
                    override = json.loads(row.value)
                except ValueError:
                    override = None
            item["override"] = override
            item["effective"] = _jsonable(getattr(current, key))
            item["pending"] = _jsonable(hub.pending_restart[key]) if key in hub.pending_restart else None
            item["out_of_range"] = isinstance(env_value, (int, float)) and not isinstance(env_value, bool) and (
                (lo is not None and env_value < lo) or (hi is not None and env_value > hi))
            if spec.env_only and spec.group == "admin" and role != "superadmin":
                item.update(default=None, env_value=None, override=None, effective=None, pending=None,
                            out_of_range=False, masked=True)
        items.append(item)
    revisions = await read_revisions(session)
    return {
        "groups": [list(g) for g in GROUPS], "items": items, "safe_mode": hub.safe_mode, "encryption": box is not None,
        "revision": revisions.get("settings", 0), "pending_restart": sorted(hub.pending_restart),
        "apply_errors": list(hub.apply_errors), "invalid": dict(hub.invalid), "rank_rules_managed": managed,
        "load_error": hub.load_error,
    }


def _public_entry(key: str, entry: dict) -> dict:
    """A revision log side as shown to admins: secrets never leave the server (not even encrypted)."""
    source = entry.get("source", "env")
    if SPECS.get(key) is not None and SPECS[key].secret or "enc" in entry:
        return {"secret": True, "source": source}
    return {"source": source, "value": entry.get("value")} if source == "override" else {"source": source}


async def list_revisions(session, *, before_id: int | None = None, limit: int = 30) -> dict:
    limit = max(1, min(limit, 100))
    query = select(SettingRevision).order_by(SettingRevision.id.desc()).limit(limit + 1)
    if before_id is not None:
        query = query.where(SettingRevision.id < before_id)
    rows = list((await session.scalars(query)).all())
    more = len(rows) > limit
    rows = rows[:limit]
    items = [{
        "id": r.id, "at": iso_utc(r.at), "actor": r.actor, "reason": r.reason, "reverted_by": r.reverted_by,
        "changes": [{"key": c["key"], "env": env_name(c["key"]), "op": c["op"],
                     "old": _public_entry(c["key"], c.get("old", {})),
                     "new": _public_entry(c["key"], c.get("new", {}))} for c in (r.changes or [])],
    } for r in rows]
    return {"items": items, "next_before_id": rows[-1].id if more else None}


async def revert(session, app, actor, revision_id: int, *, reason: str, confirm: str | None, stepped_up: bool,
                 acknowledge_conflicts: bool, actor_totp: bool = True) -> SaveResult:
    target = await session.get(SettingRevision, revision_id)
    if target is None:
        raise SettingsError(404, "Revision not found")
    if target.reverted_by is not None:
        raise SettingsError(409, "Revision already reverted")
    keys = [c["key"] for c in target.changes or []]
    later = (await session.scalars(select(SettingRevision).where(SettingRevision.id > revision_id))).all()
    touched = {c["key"] for r in later for c in (r.changes or [])}
    conflicts = [k for k in keys if k in touched]
    if conflicts and not acknowledge_conflicts:
        raise SettingsError(409, "Revert conflicts", details={"conflicts": conflicts})
    box = box_for(app.state.base_settings)
    changes: dict[str, object] = {}
    for c in target.changes or []:
        old = c.get("old", {})
        if old.get("source") != "override":
            changes[c["key"]] = None
        elif "enc" in old:
            plain = _decrypt(box, old["enc"])
            if plain is None:
                raise SettingsError(409, "Encryption key not configured" if box is None else "Cannot decrypt old value",
                                    fields={c["key"]: "undecryptable"})
            changes[c["key"]] = plain
        else:
            changes[c["key"]] = old.get("value")
    result = await save(session, app, actor, changes, reason=reason, confirm=confirm, stepped_up=stepped_up,
                        action="settings.revert", actor_totp=actor_totp)
    target = await session.get(SettingRevision, revision_id)
    target.reverted_by = result.revision
    await session.commit()
    return result


async def export_overrides(session, app) -> dict:
    overrides: dict[str, object] = {}
    omitted: list[str] = []
    for key, row in sorted((await _rows(session)).items()):
        spec = SPECS.get(key)
        if spec is None:
            continue
        if spec.secret or row.secret:
            omitted.append(env_name(key))
            continue
        try:
            overrides[env_name(key)] = json.loads(row.value)
        except ValueError:
            continue
    return {"format": EXPORT_FORMAT, "version": EXPORT_VERSION,
            "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "app_version": app.state.settings.app_version, "overrides": overrides, "secrets_omitted": omitted}


async def import_preview(session, app, payload: dict) -> dict:
    if not isinstance(payload, dict) or payload.get("format") != EXPORT_FORMAT \
            or payload.get("version") != EXPORT_VERSION or not isinstance(payload.get("overrides"), dict):
        raise SettingsError(400, "Unsupported file")
    base: Settings = app.state.base_settings
    current: Settings = app.state.settings
    managed = await rank_rules_managed(session)
    items, danger_keys = [], []
    for env, raw in list(payload["overrides"].items())[:500]:
        env = str(env)[:64]
        key = env.lower()
        spec = SPECS.get(key)
        item: dict = {"env": env, "key": key if spec else None}
        if spec is None:
            item["status"] = "unknown"
        elif spec.env_only or (spec.managed_by == "rank_rules" and managed)                 or (key in SEASON_KEYS and season_started(current)):
            item["status"] = "read_only"
        elif spec.secret:
            item["status"] = "secret"
        else:
            try:
                value = getattr(compose(base, {key: raw}), key)
            except OverrideError as exc:
                item.update(status="invalid", message=str(next(iter(exc.fields.values()), "invalid value"))[:200])
            else:
                old = getattr(current, key)
                if value == old:
                    item["status"] = "unchanged"
                else:
                    danger = danger_reasons(key, old, value)
                    item.update(status="changed", old=_jsonable(old), new=_jsonable(value), danger=danger)
                    item["value"] = raw
                    if danger:
                        danger_keys.append(key)
        items.append(item)
    return {"items": items, "confirm": confirm_phrase(sorted(danger_keys)) if danger_keys else None}


async def import_apply(session, app, actor, payload: dict, *, reason: str, confirm: str | None,
                       stepped_up: bool, actor_totp: bool = True) -> SaveResult:
    preview = await import_preview(session, app, payload)
    changes = {i["key"]: i["value"] for i in preview["items"] if i["status"] == "changed"}
    if not changes:
        raise SettingsError(409, "Nothing to change")
    return await save(session, app, actor, changes, reason=reason, confirm=confirm, stepped_up=stepped_up,
                      action="settings.import", actor_totp=actor_totp)
