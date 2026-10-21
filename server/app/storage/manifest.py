"""Migration manifest: an append-only JSONL file, one line per state change, the last line for a key wins (plan L1 R12,
spec section 6). A torn last line (a crash mid-write) is ignored. The file holds object keys: it is an operator file,
never a log; it is created with mode 0600 where the platform supports it."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

PENDING, VERIFIED, FAILED = "pending", "verified", "failed"


@dataclass(frozen=True)
class Entry:
    key: str
    size: int
    sha256: str | None
    state: str = PENDING
    error: str = ""  # an error CODE only (integrity, unavailable, ...), never a message


def _ensure_file(path: Path) -> None:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)


def append(path: Path, entry: Entry) -> None:
    _ensure_file(path)
    line = json.dumps(asdict(entry), ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def load(path: Path) -> dict[str, Entry]:
    """The latest entry per key. Malformed lines (a torn write) are skipped; nothing else is trusted."""
    latest: dict[str, Entry] = {}
    if not path.is_file():
        return latest
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            data = json.loads(raw)
            entry = Entry(key=str(data["key"]), size=int(data["size"]), sha256=data.get("sha256"),
                          state=str(data.get("state", PENDING)), error=str(data.get("error", "")))
        except (ValueError, KeyError, TypeError):
            continue
        latest[entry.key] = entry
    return latest
