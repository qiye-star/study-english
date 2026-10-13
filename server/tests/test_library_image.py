"""镜像与部署文件(spec §5.1、§7.3):最终阶段以 root 安装 ffmpeg(含 ffprobe),再切到非 root 用户;仍是单 worker。"""
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


def test_the_runtime_image_installs_ffmpeg_before_dropping_root():
    text = (SERVER / "Dockerfile").read_text(encoding="utf-8")
    final = text[text.rindex("FROM python:3.12-slim\n"):]
    install = final.index("apt-get install -y --no-install-recommends ffmpeg")
    assert install < final.index("USER app")
    assert "rm -rf /var/lib/apt/lists/*" in final
    assert "--workers 1" in final  # the in-process queue, tickets and upload locks need one worker


def test_env_example_documents_every_library_setting():
    from app.core.config import Settings
    text = (SERVER / ".env.example").read_text(encoding="utf-8")
    for key in Settings.model_fields:
        if key.startswith("library_"):
            assert f"# {key.upper()}=" in text, key
