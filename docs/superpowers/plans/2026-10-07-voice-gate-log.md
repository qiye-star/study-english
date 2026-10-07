# 语音提速 / 按住说话 / 实时通话 —— 门槛记录(计划 2026-10-07-voice-speed-hold-to-talk-realtime)

| 日期 | 阶段/任务 | 提交 | 命令 | 结果 |
|---|---|---|---|---|
| 2026-10-07 | 基线 | BASE=e79ce013 | `uv run pytest -q`;`yarn workspace web test` | BASE_PY=755 passed;BASE_WEB=850 passed(75 个文件);开工时 git status 仅 `M docker-compose.yml`(用户未提交,不纳入提交) |
| 2026-10-07 | 0.1 延迟打点 | (见 git log) | `uv run pytest -q`;`yarn workspace web typecheck/test/build` | server 759 passed(基线 755 + 4);web 855 passed(基线 850 + 5);typecheck、build 通过 |
