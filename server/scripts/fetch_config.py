"""下载官方公开配置作为静态快照。仅在需要刷新快照时运行。

Usage: uv run python scripts/fetch_config.py
"""
import json
from pathlib import Path

import httpx

KEYS = [
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
]
OUT = Path(__file__).resolve().parent.parent / "app" / "static_config"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True) as http:
        for key in KEYS:
            r = http.get(f"https://enjoy.bot/api/config/{key}")
            r.raise_for_status()
            data = r.json()
            (OUT / f"{key}.json").write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"saved {key} ({len(r.content)} bytes)")


if __name__ == "__main__":
    main()
