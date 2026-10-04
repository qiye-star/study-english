# 客户端端到端验收清单(Task 5.6)

状态:**尚未执行。** 本清单需要在能运行 Electron 应用、并配好真实上游(LLM / TTS / Whisper / Azure Speech)的机器上手动完成。
自动化 Agent 所在环境没有原生模块的构建工具链(`sqlite3` 等构建失败),也没有真实密钥,因此无法执行。

执行前:后端已运行并填好 `server/.env`;`enjoy/.env` 中 `VITE_API_URL` 指向它;运行 `yarn enjoy:start`;
DevTools(`Ctrl+Shift+I`)Network 面板过滤 `/api`。结果请把「未执行」改成 ✅ / ❌ 并写备注。

| # | 操作 | 预期 | 结果 |
|---|---|---|---|
| 1 | 全新用户注册 | 进入主界面,个人目录名为 8 位数字 | 未执行 |
| 2 | 退出 → 重新登录;再用「已记住的用户」进入 | 两种方式都成功 | 未执行 |
| 3 | 新建对话(默认 Ava),发一条英文消息 | 回复流式出现 | 未执行 |
| 4 | 对话里播放回复语音(`azure/speech`) | 有声音 | 未执行 |
| 5 | 新建角色把语音改为 `openai/tts-1` 并播放 | 有声音 | 未执行 |
| 6 | 对话里录音并评测发音 | 出现发音评分;`POST /api/speech/tokens` 200 | 未执行 |
| 7 | 「发音评测」页新建评测 | 评分出现 | 未执行 |
| 8 | 导入英文音频,STT 选 Azure | 转写成功 | 未执行 |
| 9 | 同一音频,STT 选「服务器 Whisper」 | 转写成功,有分句 | 未执行 |
| 10 | 字幕里点生词,查 AI 词典 | 显示释义 | 未执行 |
| 11 | 触发一次翻译 | 译文出现 | 未执行 |
| 12 | 依次点开侧边栏每个入口 | 无崩溃;无指向官方服务器的请求;无 `/api` 的 404/500 | 未执行 |
| 13 | 偏好设置各 Tab | 无 OpenAI 密钥、邮箱、余额、充值入口 | 未执行 |
| 14 | 关闭服务端后再操作 AI | 有可读的错误提示,应用不崩溃 | 未执行 |
| 15 | 讯飞发音评测:录音并带参考文本后评测 | 评分环、单词和音素色块正常;`POST /api/speech/assessments` 200 | 未执行 |
| 16 | 讯飞发音评测:读错内容(与参考文本不符) | 多个词标为遗漏,总分接近 0 | 未执行 |
| 17 | 讯飞发音评测:没有参考文本 | 评测页提示「需要参考文本」且不创建录音;录音详情页不弹错误 | 未执行 |

> 说明:第 6、7 项原先描述的是 Azure 路径,现已改为走讯飞接口(同 15–17);后端侧的真实调用已验证(见 server/README.md 与 Gate A 记录)。

| 18 | 新用户首次打开应用时 TTS 默认模型/音色(豆包语音合成 `volcengine/seed-tts-2.0`) | 播放回复语音有声音 | 未执行 |
| 19 | 新建/编辑角色:模型选 `volcengine/seed-tts-2.0`,音色下拉 | en-US 学习者 64 个、en-GB 学习者 4 个,中文学习者 90 个(Tim、Dacey、Stokie 等在 en-US 中);切换模型后音色自动重置 | 未执行 |
| 20 | 偏好设置里的 TTS 设置切换模型 | 音色自动重置为该模型下当前语言的第一个音色 | 未执行 |
| 21 | 语音转写选「服务器 Whisper」(方舟 2.0-lite 转写) | 转写出文字,字幕由客户端本地对齐出时间轴 | 未执行 |


## 手机网页版 Playwright 端到端(Task 6.1)

日期:2026-10-04;commit:740ec96a;E2E 栈:`docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait`(全新构建,真实上游,密钥来自 server/.env,未记录)。
运行方式:chromium-mobile(Pixel 7 模拟)在 Windows 11 主机上原生运行;webkit-mobile(iPhone 14 模拟)在 Linux 容器 `mcr.microsoft.com/playwright:v1.51.0-noble` 中运行(`--network container:enjoy-e2e-server-1`)。
注意:这是 Playwright 的 Chromium / WebKit 引擎加设备模拟,**未在真实 iOS Safari 或 Android 设备上测试**。

| 用例 | chromium-mobile(Pixel 7) | webkit-mobile(iPhone 14) | 备注 |
|---|---|---|---|
| login.spec.ts(5:注册/退出/登录、错误密码、深链、移动布局约束、同源托管) | ✅ 5/5 | ✅ 5/5 | |
| practice.spec.ts:评测/保存/回放/删除 | ✅ | 跳过 | 总分 84.2、词数 22;WebKit 跳过原因:Playwright WebKit 没有 MediaRecorder(见阶段 0 结论) |
| practice.spec.ts:切后台保留录音 | ✅ | 跳过 | 同上 |
| chat.spec.ts:流式/持久化/朗读/删除 | ✅ | ✅ | 朗读:`/api/ai/audio/speech` 200、audio/*、内容长度 > 1000 字节、播放状态到达 playing(用例不断言具体模型) |
| chat.spec.ts:听写填入输入框且不发送 | ✅ | 跳过 | 同上(无 MediaRecorder) |
| chat.spec.ts:输入栏可见 | ✅ | ✅ | |
| lookup.spec.ts:查词/翻译,第二次命中缓存 | ✅ | ✅ | |

合计:chromium-mobile 11 通过、0 跳过;webkit-mobile 8 通过、3 跳过、0 失败。一次运行全部通过,无重试。
配套检查:`server` pytest 390 通过;`yarn workspace web test` 42 文件 / 257 测试通过;typecheck 与 build 通过。
