"""运行时配置(管理后台 v2 spec §3):env(base)叠加数据库覆盖 → 有效 Settings;
SettingsHub 预检/原子替换/通知监听器;修订号轮询让重启与多进程最终一致。
日志只写键名与原因码,绝不写值。"""
import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import Settings
from app.core.secretbox import SecretBox, SecretBoxError, box_for
from app.core.settings_registry import SPECS, SettingSpec, choices_for, effective_bounds
from app.models import ConfigRevision, SettingOverride

logger = logging.getLogger(__name__)

WS_KEYS = {"asr_stream_url", "asr_realtime_url", "xfyun_ws_url"}


class OverrideError(Exception):
    def __init__(self, fields: dict[str, str]):
        super().__init__("invalid settings")
        self.fields = fields


def _fail(key: str, msg: str):
    raise OverrideError({key: msg})


def coerce(spec: SettingSpec, raw: object) -> object:
    key = spec.key
    if spec.env_only:
        _fail(key, "Setting is read-only")
    if spec.kind == "enum" and isinstance(raw, int) and not isinstance(raw, bool):
        raw = str(raw)
    if spec.kind in ("str", "text", "secret", "enum", "csv", "url", "json", "date") and not isinstance(raw, str):
        _fail(key, "expected a string")
    if spec.kind == "bool":
        if not isinstance(raw, bool):
            _fail(key, "expected true or false")
        return raw
    if spec.kind in ("int", "float"):
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            _fail(key, "expected a number")
        value = int(raw) if spec.kind == "int" else float(raw)
        if spec.kind == "int" and value != raw:
            _fail(key, "expected an integer")
        lo, hi = effective_bounds(spec)
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            _fail(key, f"must be between {lo} and {hi}")
        return value
    text = raw.strip() if spec.kind not in ("text",) else raw
    if spec.kind == "text" and spec.max is not None and len(text) > spec.max:
        _fail(key, f"at most {int(spec.max)} characters")
    if spec.kind == "enum":
        choices = choices_for(key) or ()
        if text not in choices:
            _fail(key, "must be one of " + ", ".join(choices))
        return int(text) if key == "realtime_tts_sample_rate" else text
    if spec.kind == "csv":
        seen: list[str] = []
        for item in (p.strip() for p in text.split(",")):
            if item and item not in seen:
                seen.append(item)
        return ",".join(seen)
    if spec.kind == "url":
        if not text:
            return ""
        allowed = ("ws", "wss") if key in WS_KEYS else ("http", "https")
        parts = urlsplit(text)
        if parts.scheme not in allowed or not parts.hostname or parts.username or parts.password or parts.fragment:
            _fail(key, "must be a " + "/".join(allowed) + " URL without credentials or fragment")
        return text
    if spec.kind == "json":
        try:
            json.loads(text)
        except ValueError:
            _fail(key, "must be valid JSON")
        return text
    if spec.kind == "date":
        try:
            return date.fromisoformat(text)
        except ValueError:
            _fail(key, "must be YYYY-MM-DD")
    return text


def compose(base: Settings, overrides: dict[str, object]) -> Settings:
    checked: dict[str, object] = {}
    for key, value in overrides.items():
        spec = SPECS.get(key)
        if spec is None:
            _fail(key, "Unknown setting")
        checked[key] = coerce(spec, value if not isinstance(value, date) else value.isoformat())
    try:
        return type(base)(_env_file=None, **{**base.model_dump(), **checked})
    except ValidationError as exc:
        fields: dict[str, str] = {}
        for err in exc.errors():
            key = str(err["loc"][0]) if err.get("loc") else "?"
            fields[key] = "invalid value" if SPECS.get(key) and SPECS[key].secret else err["msg"]
        raise OverrideError(fields) from None


def runtime_problems(s: Settings) -> list[str]:
    problems: list[str] = []
    # invite mode no longer needs INVITE_CODE: admin-issued DB codes work too (admin v2 §7); the config doctor
    # warns when neither exists (`invite_without_codes`)
    if s.default_llm_model not in s.llm_model_list:
        problems.append("DEFAULT_LLM_MODEL must be one of LLM_MODELS")
    if s.admin_enabled and len(s.admin_password) < 12:
        problems.append("ADMIN_PASSWORD must be at least 12 characters")
    return problems


@dataclass
class Listener:
    name: str
    keys: frozenset[str] | None
    apply: Callable[[Settings, Settings], None]
    prepare: Callable[[Settings], None] | None = None


def _changed(old: Settings, new: Settings) -> set[str]:
    return {k for k in SPECS if getattr(old, k) != getattr(new, k)}


class SettingsHub:
    def __init__(self, state):
        self._state = state
        self._listeners: list[Listener] = []
        self.pending_restart: dict[str, object] = {}
        self.apply_errors: list[str] = []
        self.invalid: dict[str, str] = {}
        self.safe_mode = False
        self.load_error: str | None = None  # exception type of the last failed override load, else None

    @property
    def current(self) -> Settings:
        return self._state.settings

    def subscribe(self, name, apply, *, keys=None, prepare=None) -> None:
        self._listeners = [l for l in self._listeners if l.name != name]
        self._listeners.append(Listener(name, frozenset(keys) if keys else None, apply, prepare))

    def _relevant(self, changed: set[str]):
        return [l for l in self._listeners if l.keys is None or l.keys & changed]

    def prepare(self, new: Settings) -> None:
        for listener in self._relevant(_changed(self.current, new)):
            if listener.prepare is None:
                continue
            try:
                listener.prepare(new)
            except Exception as exc:  # noqa: BLE001 - surfaced as a field error, value never echoed
                keys = sorted(listener.keys or {"?"})
                raise OverrideError({keys[0]: str(exc)[:200]}) from None

    def publish(self, new: Settings, *, startup: bool = False) -> list[str]:
        old = self.current
        if not startup:
            keep = {k: getattr(old, k) for k in _changed(old, new) if SPECS[k].apply == "restart"}
            self.pending_restart = {k: getattr(new, k) for k in keep}
            new = new.model_copy(update=keep) if keep else new
        else:
            self.pending_restart = {}
        changed = _changed(old, new)
        self._state.settings = new
        errors: list[str] = []
        for listener in self._relevant(changed) if changed else []:
            try:
                listener.apply(old, new)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{listener.name}: {type(exc).__name__}")
                logger.warning("settings listener failed name=%s error=%s", listener.name, type(exc).__name__)
        self.apply_errors = errors
        return errors


async def load_overrides(session, box: SecretBox | None) -> tuple[dict[str, object], dict[str, str]]:
    rows = (await session.scalars(select(SettingOverride))).all()
    values: dict[str, object] = {}
    invalid: dict[str, str] = {}
    for row in rows:
        spec = SPECS.get(row.key)
        if spec is None:
            invalid[row.key] = "unknown"
            continue
        try:
            if row.secret:
                if box is None:
                    invalid[row.key] = "undecryptable"
                    continue
                value: object = box.decrypt(row.value)
            else:
                value = json.loads(row.value)
            coerce(spec, value)
        except SecretBoxError:
            invalid[row.key] = "undecryptable"
            continue
        except (ValueError, OverrideError):
            invalid[row.key] = "invalid"
            continue
        values[row.key] = value
    return values, invalid


async def reload_from_db(app, *, startup: bool = False) -> None:
    hub: SettingsHub = app.state.settings_hub
    base: Settings = app.state.base_settings
    hub.safe_mode = base.admin_settings_safe_mode
    if hub.safe_mode:
        hub.invalid = {}
        hub.publish(base, startup=True)
        return
    try:
        async with app.state.sessionmaker() as session:
            values, invalid = await load_overrides(session, box_for(base))
    except Exception as exc:  # noqa: BLE001 - e.g. migrations not run yet: keep serving on the current settings
        hub.load_error = type(exc).__name__
        logger.warning("settings overrides unavailable error=%s", hub.load_error)
        return
    hub.load_error = None
    good: dict[str, object] = {}
    for key, value in values.items():  # per-key compose: one bad key never blocks the others
        try:
            compose(base, {**good, key: value})
            good[key] = value
        except OverrideError:
            invalid[key] = "invalid"
    effective = compose(base, good)
    if runtime_problems(effective):
        invalid.update({k: "conflict" for k in good})
        effective = base
    for key, reason in invalid.items():
        logger.warning("settings override ignored key=%s reason=%s", key, reason)
    hub.invalid = invalid
    hub.publish(effective, startup=startup)


async def bump_revision(session, name: str) -> int:
    row = await session.get(ConfigRevision, name)
    if row is None:
        row = ConfigRevision(name=name, revision=0)
        session.add(row)
    row.revision += 1
    row.updated_at = datetime.now(timezone.utc)
    return row.revision


async def read_revisions(session) -> dict[str, int]:
    return {r.name: r.revision for r in (await session.scalars(select(ConfigRevision))).all()}


STARTUP_HOOKS: list = []


def register_startup_hook(fn):
    if fn not in STARTUP_HOOKS:
        STARTUP_HOOKS.append(fn)
    return fn


async def run_startup_hooks(app) -> None:
    """lifespan calls this after reload_from_db; one failing hook is logged (name + type) and skipped."""
    for hook in list(STARTUP_HOOKS):
        try:
            await hook(app)
        except Exception as exc:  # noqa: BLE001
            logger.warning("startup hook failed name=%s error=%s", getattr(hook, "__name__", "?"), type(exc).__name__)


def _callbacks(app) -> dict[str, list]:
    callbacks = getattr(app.state, "revision_callbacks", None)
    if callbacks is None:
        callbacks = {}
        app.state.revision_callbacks = callbacks
    return callbacks


def on_revision(app, name: str, fn) -> None:
    """Call `fn` (sync or async) whenever config_revisions[name] changes (any process bumped it)."""
    fns = _callbacks(app).setdefault(name, [])
    if fn not in fns:
        fns.append(fn)


async def _revision_changed(app, name: str) -> None:
    if name == "settings":
        await reload_from_db(app)
    for fn in list(_callbacks(app).get(name, [])):
        try:
            result = fn()
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:  # noqa: BLE001 - one bad callback never stops the others or the watcher
            logger.warning("revision callback failed name=%s error=%s", name, type(exc).__name__)


async def check_revisions(app, seen: dict[str, int] | None) -> dict[str, int]:
    """One polling step (exposed for tests): reload/notify for every revision that moved since `seen`."""
    async with app.state.sessionmaker() as session:
        current = await read_revisions(session)
    if seen is not None:
        for name, rev in current.items():
            if rev != seen.get(name):
                await _revision_changed(app, name)
    return current


async def watch_revisions(app, interval: float = 5.0) -> None:
    seen: dict[str, int] | None = None
    while True:
        try:
            seen = await check_revisions(app, seen)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("revision watch failed error=%s", type(exc).__name__)
        await asyncio.sleep(interval)
