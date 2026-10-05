# 客户端端到端验收清单(Task 5.6)


## OPEN ACCEPTANCE ITEMS (not yet verified)

以下验收项**尚未验证**,不得视为通过。其余自动化结果见下方各节。

1. **语音消息 E2E 用例从未运行**(`web/e2e/chat.spec.ts` 的 "voice message" 用例)。原因:方舟 STT 账户欠费。账户充值后运行:先按 `web/README.md` 起 E2E 栈,然后 `E2E_REAL_STT=1 yarn web:e2e --project=chromium-mobile`(webkit 无 MediaRecorder,按 `WEBKIT_NO_RECORDER` 跳过)。需要检查:转写气泡与录音时长、流式回复、发音与语法徽标、`PATCH` 补写、刷新后回放、"跟读这句";并用 `docker exec`(进入 `enjoy-e2e-server-1`)确认删除对话后该条录音文件(assessment 音频)已从磁盘消失,assessment 行也已级联删除。
2. **依赖 TTS 的用例失败**:练习页"先听范读"(chromium 与 webkit)、对话朗读(webkit),原因是火山 TTS 返回 403 `resource not granted`(不是应用缺陷)。TTS 授权恢复后重跑 `practice.spec.ts` 与 `chat.spec.ts`(两个项目)。2026-10-05 Task 6.1 重跑:仍是同一个 403,且新增的场景自动朗读用例同样受阻;语音消息用例的转写预检返回 "Upstream authentication failed"(见下方 Task 6.1 一节)。
3. **自由说话评测未运行**:见 [2026-10-05-free-speech-evaluation.md](2026-10-05-free-speech-evaluation.md)(状态:NOT RUN)。命令:`cd server && uv run python scripts/eval_free_speech.py --base-url http://127.0.0.1:8765 --json ../.superpowers/eval/free-speech.json`,需要 ffmpeg 与真实上游(方舟转写、火山 TTS、讯飞评测、LLM),用临时库;会产生真实上游调用费用(约 52 次 TTS 合成(26 句 × 2 音色,有缓存时重跑为 0),另有 53 次转写、65 次评测、至多 53 次语法),运行前请确认额度。Task 5.3(据评测结论的降级)**未执行,待评测结果**。
4. **真机验收**:iPhone(Safari)与安卓(Chrome)按下方清单第 1–16 项逐项验证,全部为"未验证"(需要设备与 HTTPS 地址)。
5. **语音消息的语法检查未经验证(风险)**:`GRAMMAR_FOR_VOICE`(`web/src/features/chat/turn-results.ts`)为 `true`。转写引擎可能悄悄纠正语法,导致语音消息显示误导性的"没有语法问题";该风险尚未用真实转写验证(依赖第 3 项)。如评测证实,将该常量改为 `false` 即可关闭(一行改动,并同步 `turn-results.test.ts` 中对其取值的断言)。

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


## 手机网页版真机验收(Task 6.2)

状态:**未验证。这是整个项目唯一仍未完成的验收项。** 真机验收需要一台 iPhone(Safari)、一台安卓(Chrome)和一个指向服务的 HTTPS 地址;自动化 Agent 所在环境既没有真机也没有 HTTPS 地址,因此下表所有格子均为「未验证」,没有任何一项被标为通过。上一节的 Playwright 结果只是引擎加设备模拟,不能替代真机。

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
