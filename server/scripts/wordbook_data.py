#!/usr/bin/env python3
"""下载 / 校验背单词词典数据(spec 2026-10-10-wordbook §3)。只用标准库,不被 app 导入。

在 server/ 下运行:
  uv run python scripts/wordbook_data.py download [--dest DIR]   # 按 SOURCE.json 的固定提交下载并校验
  uv run python scripts/wordbook_data.py verify [--dest DIR]     # 只校验字节数与 sha256
"""
import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
DEFAULT_DIR = SERVER / "dictionaries" / "kylebing-english-vocabulary"
RAW = "https://raw.githubusercontent.com/{repo}/{commit}/{path}"


def load_manifest(directory: Path) -> dict:
    return json.loads((directory / "SOURCE.json").read_text(encoding="utf-8"))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(directory: Path) -> list[str]:
    problems: list[str] = []
    for book in load_manifest(directory)["books"]:
        path = directory / book["file"]
        if not path.is_file():
            problems.append(f"{book['file']}: missing")
        elif path.stat().st_size != book["bytes"]:
            problems.append(f"{book['file']}: size {path.stat().st_size} != {book['bytes']}")
        elif sha256_of(path) != book["sha256"]:
            problems.append(f"{book['file']}: sha256 mismatch")
    return problems


def download(directory: Path, manifest_dir: Path) -> None:
    manifest = load_manifest(manifest_dir)
    directory.mkdir(parents=True, exist_ok=True)
    if not (directory / "SOURCE.json").is_file():  # --dest 指向别处时带上清单,verify 才能独立运行
        (directory / "SOURCE.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for book in manifest["books"]:
        url = RAW.format(repo=manifest["repo"], commit=manifest["commit"], path=urllib.parse.quote(book["upstream_path"]))
        part = directory / f"{book['file']}.part"
        with urllib.request.urlopen(url, timeout=120) as response, part.open("wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
        if sha256_of(part) != book["sha256"]:
            part.unlink()
            raise SystemExit(f"{book['file']}: sha256 mismatch after download")
        part.replace(directory / book["file"])
        print(f"{book['file']}: ok ({book['bytes']} bytes)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("download", "verify"))
    parser.add_argument("--dest", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args(argv)
    if args.command == "download":
        download(args.dest, DEFAULT_DIR)
    problems = verify(args.dest)
    for line in problems:
        print(line, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
