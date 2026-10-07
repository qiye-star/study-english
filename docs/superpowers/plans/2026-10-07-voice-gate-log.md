# 语音提速 / 按住说话 / 实时通话 —— 门槛记录(计划 2026-10-07-voice-speed-hold-to-talk-realtime)

| 日期 | 阶段/任务 | 提交 | 命令 | 结果 |
|---|---|---|---|---|
| 2026-10-07 | 基线 | BASE=e79ce013 | `uv run pytest -q`;`yarn workspace web test` | BASE_PY=755 passed;BASE_WEB=850 passed(75 个文件);开工时 git status 仅 `M docker-compose.yml`(用户未提交,不纳入提交) |
| 2026-10-07 | 0.1 延迟打点 | web 5b07739f;server+门槛记录 3eb06eb2 | `uv run pytest -q`;`yarn workspace web typecheck/test/build` | server 759 passed(基线 755 + 4);web 855 passed(基线 850 + 5);typecheck、build 通过 |
| 2026-10-07 | 0.1 评审修复 | d397e23e | 全量 server/web | server 769 passed(+10);web 873 passed(+18);typecheck、build 通过;本机 uvicorn 实测 `app.timing` INFO 行已写到 stdout |
| 2026-10-07 | 0.2 测量工具与基线标签 | 278d93fa(e2e 强制 chat 识别);7a4e11b1(工具) ;标签 `voice-latency-baseline` -> 7a4e11b1 | 全量 server/web | server 774 passed(769 + 5);web 873 passed;typecheck、build 通过;`playwright --list latency` 2 项;样本已生成到 .superpowers/latency(不提交) |
