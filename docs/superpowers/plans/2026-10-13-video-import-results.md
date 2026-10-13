# 跟读库 · 结果与核对(2026-10-13)

## S1 服务端数据与任务 · S0 核对(计划 2026-10-13-video-import-server-core.md Task 0)

- 日期 / 基于提交:2026-10-13 / bc3640a3
- alembic heads:0017 (head);本计划使用的迁移号:0018
- backups.py:只备份数据库(VACUUM INTO / pg_dump 提示),不含数据目录文件
- Starlette 版本(uv.lock):1.7.0;tests/test_library_range.py:9 passed
- 镜像体积(加 ffmpeg 前 / 后):未测(需要重建镜像,按仓库规则等用户要求)
