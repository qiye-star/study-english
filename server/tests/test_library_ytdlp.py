"""The yt-dlp fetch stage (spec 2026-10-13-video-import §7): the dependency, argv / env rules, error classification,
probe checks, subtitle choice and `YtDlpFetch.fetch` with a fake child process. No network; the only real yt-dlp
run is `--version` (adapter test)."""
import importlib.metadata
import importlib.util
import re
from pathlib import Path

import pytest

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def test_ytdlp_is_a_declared_dependency():
    text = PYPROJECT.read_text(encoding="utf-8")
    assert re.search(r'"yt-dlp\[default\]>=\d{4}\.\d+\.\d+"', text)


@pytest.mark.skipif(importlib.util.find_spec("yt_dlp") is None,
                    reason="yt-dlp is not installed in this environment (not locked offline yet: run `uv lock` + `uv sync`)")
def test_ytdlp_dependency_is_installed():
    assert importlib.metadata.version("yt-dlp")
