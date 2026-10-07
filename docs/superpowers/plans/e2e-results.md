# 客户端端到端验收清单(Task 5.6)


## OPEN ACCEPTANCE ITEMS (not yet verified)

以下验收项**尚未验证**,不得视为通过。其余自动化结果见下方各节。

1. **语音消息 E2E 用例从未运行**(`web/e2e/chat.spec.ts` 的 "voice message" 用例)。原因:方舟 STT 账户欠费。2026-10-05 Task 6.1 带 `E2E_REAL_STT=1` 重跑:转写预检仍返回 502 "Upstream authentication failed",用例未能运行,本项仍然 OPEN。账户充值后运行:先按 `web/README.md` 起 E2E 栈,然后 `E2E_REAL_STT=1 yarn web:e2e --project=chromium-mobile`(webkit 无 MediaRecorder,按 `WEBKIT_NO_RECORDER` 跳过)。需要检查:转写气泡与录音时长、流式回复、发音与语法徽标、`PATCH` 补写、刷新后回放、"跟读这句";并用 `docker exec`(进入 `enjoy-e2e-server-1`)确认删除对话后该条录音文件(assessment 音频)已从磁盘消失,assessment 行也已级联删除。
2. **依赖 TTS 的用例失败**:练习页"先听范读"(chromium 与 webkit)、对话朗读(webkit),原因是火山 TTS 返回 403 `resource not granted`(不是应用缺陷)。TTS 授权恢复后重跑 `practice.spec.ts` 与 `chat.spec.ts`(两个项目)。2026-10-05 Task 6.1 重跑:仍是同一个 403,且新增的场景自动朗读用例同样受阻;语音消息用例的转写预检返回 "Upstream authentication failed"(见下方 Task 6.1 一节)。
3. **自由说话评测未运行**:见 [2026-10-05-free-speech-evaluation.md](2026-10-05-free-speech-evaluation.md)(状态:NOT RUN)。命令:`cd server && uv run python scripts/eval_free_speech.py --base-url http://127.0.0.1:8765 --json ../.superpowers/eval/free-speech.json`,需要 ffmpeg 与真实上游(方舟转写、火山 TTS、讯飞评测、LLM),用临时库;会产生真实上游调用费用(约 52 次 TTS 合成(26 句 × 2 音色,有缓存时重跑为 0),另有 53 次转写、65 次评测、至多 53 次语法),运行前请确认额度。Task 5.3(据评测结论的降级)**未执行,待评测结果**。
4. **真机验收**:iPhone(Safari)与安卓(Chrome)按下方清单第 1–16 项逐项验证,全部为"未验证"(需要设备与 HTTPS 地址)。
5. **语音消息的语法检查未经验证(风险)**:`GRAMMAR_FOR_VOICE`(`web/src/features/chat/turn-results.ts`)为 `true`。转写引擎可能悄悄纠正语法,导致语音消息显示误导性的"没有语法问题";该风险尚未用真实转写验证(依赖第 3 项)。如评测证实,将该常量改为 `false` 即可关闭(一行改动,并同步 `turn-results.test.ts` 中对其取值的断言)。
6. **自动朗读在 iOS 上的手势解锁未经真机验证**:Playwright 的 Chromium 带自动播放参数,WebKit 结果见「对话页增强 Playwright 端到端」一节(该节记录:TTS 被上游 403 拒绝,WebKit 下自动朗读是 playing 还是被拦截的结果**未记录**);iPhone 上首次发送后是否自动出声、被拦截时"点此朗读"是否出现且可用,按真机清单第 17–22 项验证。

7. **语音提速与实时通话的真实上游验收**(计划 2026-10-07):延迟基线/对比、流式识别、实时通话端到端依赖火山 TTS 与方舟识别恢复;状态见 [2026-10-07-voice-spike-results.md](2026-10-07-voice-spike-results.md) 与 [2026-10-07-voice-latency.md](2026-10-07-voice-latency.md)。截至本节写入(2026-10-07,代码基线 `43557d07`)实际发生过的事:
   - 上游当日已恢复,spike(Task 0.3–0.5)用真实上游跑过:识别参数与 `<none>`、按真实节奏推流的 `bigmodel_async`、TTS 分块与 PCM 格式,以及**服务端层**基线(识别 s5/s15、TTS 整段/首句);数字与环境只以延迟文档、spike 结论为准,此处不重复。
   - **没有完成**:浏览器层基线(需要 Docker Desktop,当时未运行);"之后"对比(Task 5.1,浏览器层同样需要 Docker),**是否达到"转写 ≤ 基线 50%、回复完成 → 出声 ≤ 基线 40%"以延迟文档为准,本文不下结论**;spike 结论 §7.2 已预告:两句短回复在服务端层首块/整段约 47–56%,达不到 40%,不得因此修改目标。
   - **没有完成**:实时通话对真实上游的端到端冒烟(Task 5.2)。服务端的通话路径只用假上游、Starlette TestClient 和进程内的真实 uvicorn(仅验证票据日志脱敏)测过;`REALTIME_ASR_MODE=stream` 的适配器只对着本地假 `bigmodel_async` 服务测过,真实上游只验证了推流协议(spike)。若 Task 5.2 之后有结果,以它的记录为准并回写此处。
   - 仍未验证的上游相关项:LLM 流在没有 `[DONE]`/`finish_reason` 时按"截断"处理(真实 DeepSeek 流是否总带其一未核对);通话评测(讯飞)与录音落盘在通话里的真实表现;`bigmodel_async` 的最长连接时长、空闲超时、超过 2 路并发(通话 5 路 + 上传识别 3 路)、非连续音频;TTS 24 kHz 的听感核对(未排除 22050)。
8. **语音提速、按住说话与实时通话的真机验收**:iPhone(Safari)与安卓(Chrome)按下方清单第 23–32 项逐项验证,全部为"未验证"(需要设备与 HTTPS 地址)。其中依赖真机才能回答的关键问题:iOS 上 AudioWorklet/页面级 `AudioContext` 点击解锁后是否保持 `running`、`getUserMedia` 不在点击同步阶段时通话能否开麦、外放回声、系统手势是否触发 `pointercancel`。
9. **流式通话识别的准确度**:spike 里 `bigmodel_async` 9/9 次丢了 "ask not" 的 "ask"(chat 模式同一段正确);通话转写是发音评测的参考文本,错词会影响评分。默认 `REALTIME_ASR_MODE=buffered`;打开 `stream` 前需用真实麦克风核对(含中文/中英混说、噪声)。
10. **Docker 与 Playwright 相关门槛未运行**(本环境没有 Docker):镜像构建(含 `--ws-max-size 65536` 与新依赖/VAD 资源复制)、Postgres 套件、`hold-to-talk.spec.ts`(4 个用例,只 chromium-mobile,CDP 触摸合成)与 `latency.spec.ts` 的真实运行,以及改过的 `chat.spec.ts` 语音消息用例(仍需 `E2E_REAL_STT=1`)。这些规格文件写好并通过 `playwright test --list` 和类型检查,**从未运行过**,第一次运行可能要调整触摸合成、选择器与滑动坐标。
11. **生产反向代理(1Panel/OpenResty)转发 WebSocket**:需要你在面板里开启 WebSocket 支持并把读超时调到 ≥ `REALTIME_MAX_MINUTES`(默认 10 分钟,至少 660 s);未验证,见 `server/README.md`「实时通话的部署注意」与真机清单第 32 项。同时注意票据在 URL 里,代理访问日志会记录它(应用日志已脱敏)。

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


## 对话增强 Playwright 端到端(计划 2026-10-05,Task 5.1)

日期:2026-10-05;commit:5bf86334(包含这些规格文件);E2E 栈与运行方式同上一节(chromium 原生、webkit 在 Linux 容器)。
注意:引擎加设备模拟,**未在真机上测试**;原"听写填入输入框"用例已按计划 R23 改写为语音消息用例。

**环境阻塞(两项上游问题,均不是应用缺陷,用例没有被放宽或打桩):**
1. 语音转写:Volcengine ARK 账户欠费(403 AccountOverdueError),真实转写不可用。语音消息用例由 `E2E_REAL_STT=1` 开关控制,未设置时以原因 `real STT unavailable (set E2E_REAL_STT=1 once the Ark account is funded)` 跳过;设置开关时先预检转写接口,502/503 直接失败(已验证:返回 HTTP 502 并报错)。下表记为 **SKIPPED-BLOCKED**,不是通过。
2. 语音合成:Volcengine TTS 在同一次运行中途开始返回 403 `code=45000030 resource_id=volc.seedtts.default requested resource not granted`(同一次运行里第一个朗读请求曾返回 200,随后全部 502,直接对 API 重试也一致)。依赖朗读的两个用例因此失败,记为 **FAILED-BLOCKED**(上游授权问题;账户/资源授权恢复后需重跑)。

| 用例 | chromium-mobile | webkit-mobile | 备注 |
|---|---|---|---|
| chat.spec.ts:语音消息(转写气泡、流式回复、发音/语法徽标、持久化、刷新后回放、跟读这句、删除对话级联) | SKIPPED-BLOCKED | 跳过(无 MediaRecorder) | 未运行,无发音分、assessment id 与录音文件复核结果;需 `E2E_REAL_STT=1` 且 ARK 账户充值后重跑 |
| chat.spec.ts:语法(正确句 0 处、错误句 ≥1 处、改正句跟读) | ✅ | ✅ | 改正句:`Yesterday I went to the park and bought two apples.`(两个浏览器一致) |
| chat.spec.ts:翻译与缓存、双语模式 | ✅ | ✅ | |
| chat.spec.ts:回复句子收藏 → 清单 → 跟读 | ✅ | ✅ | |
| practice.spec.ts:先听范读 | FAILED-BLOCKED | FAILED-BLOCKED | `/api/ai/audio/speech` 502(上游 TTS 403 未授权,见上) |
| lookup.spec.ts:抽屉跟读/收藏 | ✅ | ✅ | |
| grammar-prompt.spec.ts:预填默认、保存、使用、恢复默认 | ✅ | ✅ | GET 经用户令牌断言,恢复后 prompt 为 null |
| 既有用例(登录、跟读、对话、查词) | ✅ 登录 5/5、查词、跟读评测(总分 84.2、词数 22)、切后台、输入栏;对话流式/朗读用例在完整运行中通过(当时 TTS 尚可用),此后单独重跑两次均 FAILED-BLOCKED(TTS 403) | ✅ 登录 5/5、查词、输入栏;录音类按原因跳过;对话流式/朗读用例 FAILED-BLOCKED(TTS 403 已生效) | 除上游 TTS 授权外无回归 |

合计(共 17 项):chromium 完整运行 15 通过 / 1 跳过(SKIPPED-BLOCKED)/ 1 失败(先听范读,TTS 上游 403);webkit 12 通过 / 3 跳过 / 2 失败(先听范读、对话朗读,均为 TTS 上游 403)。无应用缺陷,未改动 web/src。
配套检查:`yarn workspace web test` 59 文件 / 616 测试通过;typecheck 与 build 通过。


## 对话页增强 Playwright 端到端(计划 2026-10-05-chat-enhancements,Task 6.1)

日期:2026-10-05;commit:e30eb8f5(应用代码;规格文件改动随本节一起提交);E2E 栈按当前代码全新构建(`down -v` 后 `up -d --build --wait`;镜像含迁移 0005 与 vocabulary/stats 路由,启动日志可见 `Running upgrade 0004 -> 0005`),运行方式同上一节(chromium 在 Windows 主机原生运行,webkit 在 Linux 容器 `mcr.microsoft.com/playwright:v1.51.0-noble`);chromium 带 `E2E_REAL_STT=1`。一次完整运行,无重试。
注意:引擎加设备模拟,**未在真机上测试**;Chromium 带 `--autoplay-policy=no-user-gesture-required`,自动朗读通过不代表 iOS 手势解锁有效(计划 R25)。

**环境阻塞(上游账户问题,不是应用缺陷;用例没有被放宽或打桩):**
1. 语音合成:Volcengine TTS 对每一次请求都返回 HTTP 403 `code=45000030 message=[resource_id=volc.seedtts.default] requested resource not granted`,服务端按设计转成 502。与 Task 5.1 一节记录的是同一个错误;本次运行中**没有任何一次**朗读请求成功(服务端日志 11+ 次 403,另用 curl 直接调用 `/api/ai/audio/speech` 复核仍是 502)。
2. 语音转写:`/api/ai/audio/transcriptions` 返回 502 `{"error":"Upstream authentication failed"}`(上游鉴权失败;curl 直接复核一致)。语音消息用例的预检按设计直接失败。
3. 核对:E2E 容器与用户日常容器 `everyone-can-use-english-server-1` 的上游配置项逐项哈希比较一致(只差 INVITE_CODE/REGISTRATION_MODE/RATE_LIMIT_PER_MINUTE/HOSTNAME),说明不是 E2E 栈读错了配置。密钥未打印、未记录。
下表记为 **FAILED-BLOCKED**(失败,原因为上游),不是通过;账户/资源授权恢复后需重跑。

| 用例 | chromium-mobile | webkit-mobile | 备注 |
|---|---|---|---|
| chat.spec.ts:场景开场白保存并自动朗读、回复自动朗读、关闭开关后不朗读 | FAILED-BLOCKED | FAILED-BLOCKED | 开场白 "What can I get started for you today?" 与场景标签 "Ordering coffee" 断言**已通过**;随后开场白朗读请求 502(TTS 403)。之后的"自动朗读结果 playing / blocked"、服务端首条为助手、配置只含 `{scenario, level}`、回复自动朗读、关闭开关后不朗读**均未执行**;webkit 的 playing / blocked 结果因此**未知** |
| chat.spec.ts:"不会说?"三条提示、填入输入框 | ✅ | ✅ | chromium 第一条:`I'd like to start with the tomato soup, please. And could I get a glass of water too?`;webkit 第一条:`Hi! Could I have the grilled chicken with a side salad, please?`;两次均未重试(第一次就是合法 JSON) |
| chat.spec.ts:复盘事实块、中文摘要、刷新后不再调用 | ✅ | ✅ | chromium:语法类别 2、新表达 8;webkit:语法类别 1、新表达 8;刷新后 0 次 completions 请求 |
| chat.spec.ts:语音消息(含回复自动朗读) | FAILED-BLOCKED | 跳过(无 MediaRecorder) | 预检:转写 502 "Upstream authentication failed";无发音分、无 assessment id;回复自动朗读这一新断言也未执行(TTS 同样不可用) |
| vocabulary.spec.ts:查词加入 → 复习"记得" → 盒 1、约 2 天后到期 | ✅ | ✅ | chromium:`country → box 1, due 2026-10-07T13:24:50.920192+00:00`;webkit:`country → box 1, due 2026-10-07T13:29:48.541088+00:00` |
| progress.spec.ts:当天活跃、消息数、连续天数、切 30 天 | ✅ | ✅ | 请求带 `tz_offset_minutes`;`waitForResponse` 未出现时序问题,未调整 |
| chat.spec.ts:流式/持久化/朗读/删除(本次改为先关自动朗读) | FAILED-BLOCKED | FAILED-BLOCKED | 流式、持久化、刷新恢复通过;手动朗读 `/api/ai/audio/speech` 502(TTS 403) |
| practice.spec.ts:先听范读 | FAILED-BLOCKED | FAILED-BLOCKED | `/api/ai/audio/speech` 502(TTS 403);与 Task 5.1 一节相同 |
| 既有用例(登录 5、查词 2、跟读评测、切后台、输入栏、语法、翻译/双语、收藏跟读、语法提示词) | ✅ 全部通过(跟读评测总分 83.93、词数 22;语法改正句 `Yesterday I went to the park and bought two apples.`) | ✅ 全部通过;录音类 2 项按 `WEBKIT_NO_RECORDER` 跳过 | 与上一节对比无回归;R27 的 `scenario-free` 改动在所有新建对话用例中生效 |

合计:chromium-mobile 22 项 = 18 通过 / 0 跳过 / 4 失败(均 FAILED-BLOCKED:3 项 TTS 403、1 项 STT 鉴权失败);webkit-mobile 22 项 = 16 通过 / 3 跳过(无 MediaRecorder)/ 3 失败(均 TTS 403)。未发现应用缺陷,未改动 web/src 或 server。
旁注:服务端日志里偶见 `GET /api/assessments/{id}/audio 401`,紧跟在应用带令牌的 200 之后;用 `--trace off` 重跑同一用例后消失,确认是 Playwright 追踪快照在测试后无令牌地重新抓取资源,不是应用请求。
配套检查:`yarn web:typecheck`(含 e2e 目录)通过。

命令(在仓库根目录,Git Bash):

```bash
export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
E2E_REAL_STT=1 yarn web:e2e --project=chromium-mobile > .superpowers/e2e-chromium.log 2>&1
MSYS_NO_PATHCONV=1 docker run --rm --network container:enjoy-e2e-server-1 -e E2E_BASE_URL=http://localhost:8000 -e E2E_INVITE_CODE \
  -v "$(pwd -W):/repo" -w /repo/web mcr.microsoft.com/playwright:v1.51.0-noble \
  node node_modules/@playwright/test/cli.js test --project=webkit-mobile > .superpowers/e2e-webkit.log 2>&1
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v   # 保留镜像
```

**仍未验证(本次之后):**
- 设计文档 §6 第 3 条中依赖 TTS 的部分:场景开场白自动朗读进入播放态、回复完成后自动朗读、关闭开关后不朗读;WebKit 下自动朗读是 playing 还是被拦截("点此朗读");手动朗读与"先听范读"。需要 Volcengine TTS 资源授权恢复后重跑 `chat.spec.ts` 与 `practice.spec.ts`(两个项目)。
- 语音消息用例(转写、发音/语法徽标、回放、跟读这句、级联删除、回复自动朗读):需要 Ark 转写鉴权恢复后 `E2E_REAL_STT=1` 重跑;删除对话后录音文件是否从磁盘消失仍需 `docker exec` 复核。
- 真机:iOS Safari / 安卓 Chrome 上的自动朗读(首次发送后是否自动出声)、语速切换、场景开场白朗读,以及所有**可听见的**播放——无头浏览器只能证明进入播放态,不能证明出声。
- WebKit 上的录音(Playwright WebKit 无 MediaRecorder)。


## 语音提速、按住说话与实时通话:各功能验证状态(计划 2026-10-07)

日期:2026-10-07;代码基线 `43557d07`(`feat/self-hosted-backend`,各条线已合并)。控制器在主工作区的最近一次记录:`server` pytest 1855 通过,`web` vitest 1600 通过,typecheck 与 build 通过。这些数字是单元/集成测试,不等于下表里"真实上游"或"真机"的结论。

状态说明:
- **unit-tested (fakes)**:只用假设备、假 `AudioContext`/`WebSocket`/VAD、jsdom 或假上游测过。
- **server-integration tested with fakes**:服务端用 Starlette TestClient 或本地假上游服务测过,没有连真实上游。
- **real-upstream verified**:用真实上游跑过(仅限 spike/基线,见延迟文档与 spike 结论)。
- **UNVERIFIED**:没有验证(缺设备、Docker、HTTPS 地址或尚未运行)。

| 功能 | 状态 | 证据与没有验证的部分 |
|---|---|---|
| 延迟打点 `window.__enjoyLatency` | unit-tested (fakes) | `latency.test.ts` 与各使用点的测试;浏览器层真实数字 UNVERIFIED(需要 Docker + 真实上游,见延迟文档) |
| 识别提速:`STT_MAX_TOKENS`、`STT_DISABLE_THINKING`、`<none>` 无前景语音 | real-upstream verified;server-integration tested with fakes | spike:`doubao-seed-2-0-lite-260428` 接受 `thinking: disabled`,静音/白噪声输出 `<none>`(样本很少,次数见 spike §1);服务端测试用假上游。**UNVERIFIED**:开着推理时的 `<none>`、真实嘈杂环境/真人背景对话、其他模型 |
| `POST /api/ai/audio/speech` 的 `stream=true`(火山分块透传) | server-integration tested with fakes;real-upstream verified(分块节奏,直连火山) | 分块大小/间隔由 spike 直连火山测得;经本应用端点的首块延迟("之后"数字)以延迟文档为准(Task 5.1,未在此记录);客户端提前断开的清理只在生成器层面测过,没经真实 ASGI 断开;中文与其他音色的分块、中途断流的错误帧形态 UNVERIFIED |
| 切句器(服务端 `sentence_split.py` / 网页 `sentence-stream.ts`) | unit-tested (fakes) | 共享 `sentence_cases.json` 一致性用例(整段、逐字符、随机分块)、随机文本属性;码点长度语义已对齐。无设备相关部分 |
| 按句朗读(`TtsQueue`、`progress`、页面接线) | unit-tested (fakes) | hook 与页面测试含各中断路径(出错、切会话、卸载、关自动朗读、录音);iOS 句间间隙、点击解锁后的实际出声 UNVERIFIED(真机清单 23) |
| PCM 采集、FIR 降采样、静音裁剪、近讲能量门限 | unit-tested (fakes) | 假 `AudioContext`、真实 worklet 源码跑在假作用域里;构建产物里 worklet 在 `/assets/` 且无 `data:` 内联。**UNVERIFIED**:iOS/Safari 的 AudioWorklet 与页面上下文解锁、Firefox 采样率不一致重试、真实麦克风音质、16 kHz 对发音评分的影响(清单 30)、嘈杂环境(清单 27) |
| 语音消息"没有前景语音不上传"、"可能混入了他人声音"提示 | unit-tested (fakes) | 合成信号与阈值测试;真实语音(尤其一两个词的短答)是否被误判为无语音 UNVERIFIED |
| 按住说话(reducer、按钮、页面接线、键盘后备、上滑取消/转文字) | unit-tested (fakes) | jsdom(带补丁的 `PointerEvent`)测试,既有页面测试已改为 `holdMic`/`pressKey`。Playwright `hold-to-talk.spec.ts` 4 个用例写好但**从未运行**(无 Docker);真实触摸、iOS 首次麦克风权限、系统手势取消 UNVERIFIED(清单 23、24) |
| 通话识别 `buffered`(整句上传识别) | server-integration tested with fakes | 经 `make_transcriber`(含 `volc_stream` 优先、chat/Whisper 回退、共享并发闸门与熔断);真实上游下的通话端到端 UNVERIFIED |
| 通话识别 `stream`(`bigmodel_async`) | real-upstream verified(推流协议,spike);server-integration tested with fakes(适配器) | 适配器只对着本地假 `bigmodel_async` 测过;**UNVERIFIED**:准确度(spike 丢词,见 OPEN 第 9 项)、最长连接/空闲超时、并发 > 2、非连续音频、空的最后一包 |
| 通话服务端(协议、状态机、`WS /api/realtime`、票据、并发登记、限额) | server-integration tested with fakes | 假识别/LLM/TTS + TestClient,含打断、背压、泄漏检查、各关闭码;票据日志脱敏用进程内真实 uvicorn 验证。**UNVERIFIED**:对真实上游的端到端(Task 5.2)、真实浏览器/反向代理下的 WebSocket、多 worker(不支持) |
| 通话 LLM(`openai_llm_stream`)、TTS(`volc_tts_stream`)、评测(`XfyunAssessor`) | server-integration tested with fakes | respx/假连接;TTS 格式取自 spike(real-upstream verified:PCM16LE、无头、24 kHz 推断,听感核对 UNVERIFIED);LLM 无 `[DONE]` 的截断判定、讯飞评测在通话里的真实表现 UNVERIFIED |
| 网页 VAD(Silero,自托管资源) | unit-tested (fakes) | 对照库的真实类型核对过 API,`yarn build` 会复制 4 个文件到 `dist/vad/<版本>/`;**UNVERIFIED**:浏览器里 ORT 1.30.0 + Silero v5 的真实推理、共享 `AudioContext`、iOS、蜂窝网络加载 16.6 MB 的时间(清单 31) |
| 网页通话(状态机、`RealtimeCall`、对话框、页面入口、回放队列) | unit-tested (fakes) | 假 `WebSocket`/`AudioContext`/VAD/麦克风:各结束路径释放麦克风与上下文(有断言)、StrictMode 单连接、票据刷新、背景挂断、页面接线与复盘重载。**UNVERIFIED**:真机首次通话与首次出声延迟(清单 25)、外放回声与打断(清单 26)、电话/Siri 打断后恢复(清单 28)、切后台挂断(清单 29) |
| Docker 镜像构建、Postgres 套件、E2E 栈 | UNVERIFIED | 本环境没有 Docker;`server/Dockerfile` 的 `--ws-max-size 65536` 只改了命令行,没有构建过 |
| 反向代理(1Panel/OpenResty)转发 WebSocket | UNVERIFIED | 见 OPEN 第 11 项与清单 32 |
| 浏览器层延迟基线与"之后"对比 | UNVERIFIED | 需要 Docker Desktop 与真实上游;服务端层基线已在延迟文档,"之后"以该文件为准 |


## 手机网页版真机验收(Task 6.2)

状态:**未验证。这是需要人工设备的验收项(其余未决项见文首 OPEN ACCEPTANCE ITEMS)。** 真机验收需要一台 iPhone(Safari)、一台安卓(Chrome)和一个指向服务的 HTTPS 地址;自动化 Agent 所在环境既没有真机也没有 HTTPS 地址,因此下表所有格子均为「未验证」,没有任何一项被标为通过。上一节的 Playwright 结果只是引擎加设备模拟,不能替代真机。

### 需要人工完成的步骤

1. 用日常栈部署:`docker compose up -d --build`;注册方式自行决定(推荐 `REGISTRATION_MODE=invite` 并设置 `INVITE_CODE`)。
2. 提供 HTTPS 地址(手机浏览器只在安全上下文里允许录音,iOS「添加到主屏幕」也需要 HTTPS)。任选其一,指向 `127.0.0.1:8000`:
   - 反向代理:Caddy `reverse_proxy 127.0.0.1:8000`,请求体上限不小于 25m(见 `server/README.md`「必须使用 HTTPS」);
   - 临时隧道:如 Cloudflare Tunnel、ngrok、Tailscale Funnel 等,把公网 HTTPS 域名转发到 `http://127.0.0.1:8000`。
3. 在手机上直接打开该 HTTPS 地址,登录后按下表 1 → 10 的顺序逐项操作(每台设备各做一遍)。第 9 项:iOS 在 Safari 中「我的」页按说明「添加到主屏幕」,安卓用浏览器菜单「安装应用」。
4. 把结果写回下方表格:通过写 ✅,失败写 ❌ 并在备注里写现象;同时填入设备型号与系统/浏览器版本。

### 重点针对的风险

- iOS Safari 的 MediaRecorder 输出(mp4/aac)能否被解码并编码为服务端接受的 16 kHz 单声道 WAV(项 2、3、7);Playwright WebKit 没有 MediaRecorder,这部分从未在 WebKit 系引擎上跑过。
- 录音中切后台/锁屏导致录音中断,能否提示并保留已录内容(项 4)。
- iOS 的 TTS 自动播放解锁:首次点击朗读按钮即应出声(项 6)。
- 软键盘弹出时的视口与输入框遮挡(项 5)。
- 刘海/安全区下的顶栏与页面无横向滚动(项 2、9)。

### 清单与结果

| # | 操作 | 预期 |
|---|---|---|
| 1 | 打开 HTTPS 地址,注册/登录 | 进入「练习」 |
| 2 | 输入一句英文,点麦克风,允许权限,朗读后停止 | 几秒内出现评分页;总分、逐词结果可见;页面无横向滚动 |
| 3 | 结果页播放录音、点单词听片段 | 有声音 |
| 4 | 录音中按 Home 键/切到别的 App 再回来 | 提示录音已停止并保留,可选择评测或重录 |
| 5 | 对话页发一条消息 | 回复逐字出现;键盘弹出时输入框不被遮挡 |
| 6 | 点回复的朗读按钮 | 有声音(iOS 重点:首次点击即可播放) |
| 7 | 点麦克风说一句英文再停止 | (已被第 11 项取代:麦克风现在发送语音消息) |
| 8 | 长按选中一个单词,点「查词」;选中一句,点「翻译」 | 底部抽屉显示释义/译文;再次查同一词立即显示 |
| 9 | iOS:「我的」→「添加到主屏幕」按说明操作;安卓:浏览器菜单「安装应用」 | 主屏幕图标以全屏打开 |
| 10 | 系统切到深色模式 | 界面变为深色 |
| 11 | 对话页点麦克风说一句英文,再点停止 | 气泡同时显示录音时长与转写文字,AI 立即开始回复,随后出现发音徽标(iOS 重点:mp4 录音能否转 WAV、评测) |
| 12 | 录音中点"取消" | 不发送任何内容,系统麦克风指示熄灭 |
| 13 | 点语音气泡的播放按钮;刷新页面后再点一次 | 两次都有声音(iOS 重点:首次点击即可播放) |
| 14 | 发一条带语法错误的英文 | 出现"N 处语法问题";点开能看到改正,"跟读改正句"跳到跟读页并预填 |
| 15 | 跟读页点"先听范读" | 有声音(iOS 重点:首次点击即可播放) |
| 16 | 「我的」页修改语法检查提示词并保存,再点"恢复默认"并确认 | 状态在"使用你的规则"与"使用默认规则"之间正确切换,输入框回到默认文本 |
| 17 | 新建会话,选"咖啡店点单" | 开场白出现后自动朗读,不需要再点(iOS 重点:点场景那一下解锁) |
| 18 | 在场景会话里发一条消息 | 回复完成后自动朗读;若被浏览器拦截,出现一次"点此朗读",点后有声音 |
| 19 | 说一条语音消息(点麦克风、说完点停止) | 录音和转写期间没有任何播放;回复完成后自动朗读 |
| 20 | 朗读播放中点顶栏语速(1× → 1.25× → 0.75×) | 立即变速且音高不变;语音气泡回放与跟读页"先听范读"同样按该语速 |
| 21 | 点顶栏喇叭关闭自动朗读,再发一条 | 新回复不再朗读;刷新后开关仍为关 |
| 22 | 词汇本复习卡片点"朗读" | 有声音(iOS 重点:首次点击即可播放) |
| 23 | iPhone/安卓:对话页**按住**麦克风说一句,松手;再**轻点**一下麦克风(不按住);首次使用时在系统权限弹窗期间松手 | 按下即出现录音状态(iOS 重点:首次权限弹窗,且麦克风申请发生在手势里);松手即发送,转写出现明显快于以前(用秒表粗测并记录:____ s);轻点只出现"按住说话"提示;权限弹窗期间松手不发送、不残留录音;发送后回复第一句一结束就开始朗读(无需再点) |
| 24 | 按住后上滑到左边"取消"松手;再试上滑到右边"转文字"松手;再试按住期间下拉通知中心/上滑回桌面/来电(系统手势) | 取消:不发送、无上传、麦克风指示熄灭;转文字:文字出现在输入框并聚焦,未发送;系统手势或来电:本次录音被丢弃、不发送、麦克风指示消失(浏览器是否触发 `pointercancel` 以实际为准) |
| 25 | 顶栏点"通话"(服务端需 `REALTIME_ENABLED=true`),说一句话 | 接通并出现"聆听"状态;首次出声延迟(秒表):____ s;字幕滚动正常;首次通话时 VAD 资源加载与 `AudioContext` 是否可用(iOS 重点:麦克风申请不在点击同步阶段) |
| 26 | 机器人说话时开口打断;再**外放**(不戴耳机)通话 1 分钟,不说话 | 打断:机器人立即停下并开始听你说,字幕标"已打断";外放:机器人不会被自己的声音打断(回声保护),记录误打断次数 |
| 27 | 旁边有人说话的嘈杂环境下做按住说话与通话 | 记录误触发次数与识别混入他人声音的情况、"可能混入了他人声音"提示是否出现(只记录,不承诺;近讲模式只能降低,不能排除) |
| 28 | 通话前后被电话/Siri/闹钟打断:来电或唤起 Siri 后回到页面,再按住说话、再开一次通话 | `AudioContext` 重新解锁成功:仍能录音、通话有声音;失败时有可读提示而不是静音卡死(通话中途的 `AudioContext` 被系统挂起目前只在开始时检查) |
| 29 | 通话中切到后台或锁屏,再回来 | 通话已结束并提示"因切到后台已结束";麦克风指示消失;重新通话正常 |
| 30 | 同一句话分别用按住说话(16 kHz PCM)与以往的录音方式/桌面端评测,比较发音评分并听录音回放 | 评分无系统性偏低;回放无明显失真/混叠;记录两种路径的分数差(降采样滤波对发音评分的影响未验证) |
| 31 | 蜂窝网络(非 Wi-Fi)下首次点"通话"(清缓存),再点一次 | 首次加载 VAD 资源(约 16.6 MB)到可说话的时间:____ s;第二次(已缓存):____ s;加载失败或过慢时自动切到按住说话并提示 |
| 32 | 通过生产反向代理(1Panel/OpenResty,HTTPS)通话至少 1 分钟,必要时放到最长时长 | 接通后不以 1006 断开,通话中没有被代理超时切断;`REALTIME_MAX_MINUTES` 到点以"超过最长时长"结束;若断开,检查代理是否转发 `Upgrade`/`Connection` 头与读超时(≥ 660 s) |

第 23–32 项由计划 2026-10-07(语音提速、按住说话与实时通话)追加。第 32 项还需要一个真实的反向代理与 HTTPS 地址;第 23、25、31 项要用秒表记录数字,请把数字填进下方备注。

| # | iPhone(型号、iOS 版本:未填) | 安卓(型号、Chrome 版本:未填) | 备注 |
|---|---|---|---|
| 1 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 2 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 3 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 4 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 5 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 6 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 7 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 8 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 9 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 10 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 11 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 12 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 13 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 14 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 15 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 16 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 17 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 18 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 19 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 20 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 21 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 22 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 23 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 24 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 25 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 26 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 27 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 28 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 29 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 30 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 31 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
| 32 | 未验证(需要用户提供设备与 HTTPS 地址) | 未验证(需要用户提供设备与 HTTPS 地址) | |
