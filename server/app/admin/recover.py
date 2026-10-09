"""应急命令:docker compose exec server python -m app.admin.recover <cmd>(spec §3.9)。每个命令写审计 actor=cli。

输出只含键名、修订号与计数;密钥类覆盖只显示 "(secret)"。改动设置覆盖的命令会递增 config_revisions['settings'],
运行中的服务 5 秒内自动重新加载。
"""
import argparse
import asyncio
import getpass
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.admin import audit
from app.core.config import Settings
from app.core.db import make_engine
from app.core.runtime_settings import bump_revision
from app.core.secretbox import SecretBox, SecretBoxError
from app.models import AdminAccount, AdminLoginState, AdminRecoveryCode, AdminSession, SettingOverride

OLD_ENV, NEW_ENV = "OLD_SETTINGS_ENCRYPTION_KEY", "NEW_SETTINGS_ENCRYPTION_KEY"
_ENGINES: list = []  # engines this CLI created (disposed by main(); tests patch _sessionmaker instead)


def _sessionmaker():
    engine = make_engine(Settings().database_url)
    _ENGINES.append(engine)
    return async_sessionmaker(engine, expire_on_commit=False)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.admin.recover")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-overrides", help="list database setting overrides (secret values hidden)")
    clear = sub.add_parser("clear-overrides", help="delete all overrides, or one with --key")
    clear.add_argument("--key")
    sub.add_parser("unlock", help="clear login lockouts of an admin username").add_argument("username")
    sub.add_parser("reset-totp", help="remove TOTP and recovery codes of a DB admin account").add_argument("username")
    sub.add_parser("revoke-sessions", help="sign every admin out")
    sub.add_parser("rotate-key", help="re-encrypt stored secrets from the old to the new SETTINGS_ENCRYPTION_KEY; "
                   f"keys come from {OLD_ENV} / {NEW_ENV} or are prompted for (never on the command line)")
    return parser


def _key(env: str, prompt: str) -> str:
    """Review m11: a key on argv ends up in shell history, `ps` and `docker exec` logs; read env or a hidden prompt."""
    return (os.environ.get(env) or "").strip() or getpass.getpass(prompt).strip()


async def run(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    now = datetime.now(timezone.utc)
    async with _sessionmaker()() as s:
        if args.cmd == "list-overrides":
            for row in (await s.scalars(select(SettingOverride).order_by(SettingOverride.key))).all():
                print(f"{row.key.upper()}\t{'(secret)' if row.secret else row.value}\trev={row.revision}\tby={row.updated_by}")
            return 0
        if args.cmd == "clear-overrides":
            query = delete(SettingOverride)
            if args.key:
                query = query.where(SettingOverride.key == args.key.lower())
            count = (await s.execute(query)).rowcount or 0
            await bump_revision(s, "settings")
            await audit.record(s, audit.CLI_ACTOR, "settings.cli_clear", target_type="setting",
                               target_id=args.key.lower() if args.key else None, summary=f"cleared {count}")
            print(f"cleared {count}")
        elif args.cmd == "unlock":
            name = args.username.strip().lower()
            await s.execute(delete(AdminLoginState).where(AdminLoginState.username == name))
            await audit.record(s, audit.CLI_ACTOR, "auth.cli_unlock", target_type="admin", target_id=name)
        elif args.cmd == "reset-totp":
            account = await s.scalar(select(AdminAccount).where(AdminAccount.username == args.username.strip().lower()))
            if account is None:
                print("no such account (the env account's TOTP is ADMIN_TOTP_SECRET in .env)", file=sys.stderr)
                return 1
            account.totp_enc, account.totp_last_step = None, None
            await s.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.account_id == account.id))
            await audit.record(s, audit.CLI_ACTOR, "auth.cli_reset_totp", target_type="admin", target_id=account.username)
        elif args.cmd == "revoke-sessions":
            result = await s.execute(update(AdminSession).where(AdminSession.revoked_at.is_(None)).values(revoked_at=now))
            await audit.record(s, audit.CLI_ACTOR, "auth.cli_revoke_all", summary=f"revoked {result.rowcount or 0}")
        elif args.cmd == "rotate-key":
            try:
                old = SecretBox(_key(OLD_ENV, "old SETTINGS_ENCRYPTION_KEY: "))
                new = SecretBox(_key(NEW_ENV, "new SETTINGS_ENCRYPTION_KEY: "))
                rows = (await s.scalars(select(SettingOverride).where(SettingOverride.secret.is_(True)))).all()
                for row in rows:
                    row.value = new.encrypt(old.decrypt(row.value))
                accounts = (await s.scalars(select(AdminAccount).where(AdminAccount.totp_enc.is_not(None)))).all()
                for account in accounts:
                    account.totp_enc = new.encrypt(old.decrypt(account.totp_enc))
            except SecretBoxError as exc:  # message never contains a key or a value
                await s.rollback()
                print(f"rotate-key failed: {exc}; nothing was changed", file=sys.stderr)
                return 1
            await bump_revision(s, "settings")
            await audit.record(s, audit.CLI_ACTOR, "settings.cli_rotate_key",
                               summary=f"re-encrypted {len(rows)} overrides, {len(accounts)} totp")
            print(f"re-encrypted {len(rows)} overrides and {len(accounts)} TOTP secrets; now set SETTINGS_ENCRYPTION_KEY "
                  "to the new key and restart")
        await s.commit()
    print("ok")
    return 0


async def _main(argv: list[str]) -> int:
    try:
        return await run(argv)
    finally:
        for engine in _ENGINES:
            await engine.dispose()
        _ENGINES.clear()


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
