"""跟读库:导入音视频 / 链接 + 逐句跟读(spec docs/superpowers/specs/2026-10-13-video-import-design.md)。

一条处理流水线 + 一个进程内后台队列(`worker.LibraryWorker`,挂在 `app.state.library`);只有 admin、routers 与
`main.py` 导入本包(`tests/test_architecture.py::test_library_layer_rules`)。见本目录 CLAUDE.md。"""
