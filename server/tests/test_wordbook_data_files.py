import importlib.util
import json
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
DATA = SERVER / "dictionaries" / "kylebing-english-vocabulary"


def _script():
    spec = importlib.util.spec_from_file_location("wordbook_data", SERVER / "scripts" / "wordbook_data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_manifest_lists_seven_books_with_ascii_files():
    manifest = json.loads((DATA / "SOURCE.json").read_text(encoding="utf-8"))
    assert manifest["commit"] == "c4c6c80879ff17d7025c28fb853a4991c8e6be6a"
    assert [b["id"] for b in manifest["books"]] == ["junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat"]
    assert all(b["file"].isascii() and b["file"] == f"{b['id']}.jsonl" for b in manifest["books"])
    assert sum(b["bytes"] for b in manifest["books"]) == 45_661_272
    assert sum(b["entries"] for b in manifest["books"]) == 54_356
    assert max(b["bytes"] for b in manifest["books"]) < 50 * 1024 * 1024


def test_committed_files_match_manifest_checksums():
    assert _script().verify(DATA) == []


def test_verify_reports_missing_and_changed_files(tmp_path):
    script = _script()
    (tmp_path / "SOURCE.json").write_text(json.dumps({"repo": "x/y", "commit": "c", "books": [
        {"id": "a", "file": "a.jsonl", "bytes": 3, "sha256": "0" * 64},
        {"id": "b", "file": "b.jsonl", "bytes": 3, "sha256": script.sha256_of(DATA / "SOURCE.json")}]}), encoding="utf-8")
    (tmp_path / "b.jsonl").write_bytes(b"abc")
    problems = script.verify(tmp_path)
    assert problems[0] == "a.jsonl: missing"
    assert problems[1] == "b.jsonl: sha256 mismatch"


def test_license_notice_gitattributes_and_docker_wiring():
    assert "BSD 3-Clause License" in (DATA / "LICENSE").read_text(encoding="utf-8")
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "KyleBing/english-vocabulary" in notice and "Redistribution and use in source and binary forms" in notice
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "server/dictionaries/**/*.jsonl binary" in attrs
    assert "COPY server/dictionaries /app/dictionaries" in (SERVER / "Dockerfile").read_text(encoding="utf-8")
    assert "!server/dictionaries" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()


def test_files_are_lf_without_bom():
    for path in DATA.glob("*.jsonl"):
        head = path.read_bytes()[:4096]
        assert not head.startswith(b"\xef\xbb\xbf") and b"\r\n" not in head, path.name
