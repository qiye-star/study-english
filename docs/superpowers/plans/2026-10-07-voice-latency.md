# 语音链路延迟:基线与之后(计划 2026-10-07-voice-speed-hold-to-talk-realtime)

Task 0.5 建表并填"基线"列;Task 5.1 填"之后"列与比值(`measure_latency.py` 的 `markdown_row` 生成)。

## 测量方法

(计划「延迟测量方法」的要点。)

- **样本**:`server/scripts/latency_samples.py` 生成到 `.superpowers/latency/`(不提交)。`s5.wav` = `enjoy/samples/jfk.wav` 前 5.0 s;`s15.wav` = `jfk.wav` 全长 + 从头补足到 15.0 s;都是 16 kHz 单声道 16 位。回复文本固定为 `REPLY_TEXT = "That sounds like a great plan. What time would you like to meet tomorrow?"`。
- **两层**:
  1. 服务端层(`server/scripts/measure_latency.py`,对着本机 uvicorn):`stt_ms`(上传 WAV → 返回转写)、`tts_full_ms`(整段合成 `REPLY_TEXT`)、`tts_first_sentence_ms`(只合成第一句)、`tts_first_chunk_ms`(`stream=true` 时第一块到达,只有"之后"有意义)。TTS 请求文本带 ` (i)` 后缀,避免任何缓存。
  2. 浏览器层(`web/e2e/latency.spec.ts`,`E2E_LATENCY=1`,chromium-mobile,假麦克风 `E2E_FAKE_AUDIO`):页面 `window.__enjoyLatency` 的 `transcriptMs`(松手/点停止 → 转写出现)、`firstAudioAfterReplyMs`(回复完成 → 开始出声,流水线后可为负数,照实记录)、`firstAudioAfterReleaseMs`(松手 → 开始出声)。
- **次数与统计**:每个样本 1 次热身(不计)+ **N = 7**(浏览器层 N = 5),取**中位数**,同时记录最小/最大值。基线与"之后"在**同一天、同一台机器、同一网络**测量。
- **基线口径(R23)**:被测服务进程用进程级环境变量强制 `UPSTREAM_ASR_MODE=chat`(用户 `.env` 开的是 `volc_stream`;进程环境变量优先于 `.env`)。"之后"测两遍:`chat` 与 `volc_stream`,分列记录。

## 环境

| 项 | 值 |
|---|---|
| 日期时间 | 基线(Task 0.5)服务端层 2026-10-07 14:54:55–14:56:48(+08:00);TTS spike 同日 14:53。**Task 5.1 同日连续三段**:基线重测 16:32:06–16:33:58 → 之后(chat)16:34:05–16:35:02 → 之后(volc_stream)16:35:10–16:35:36(+08:00),同一台机器、同一网络 |
| Task 5.1 代码 | 之后 = lane-A `43557d07`(main 已合入,全部优化在内;本任务只改 `scripts/measure_latency.py`,不改 `server/app`);基线重测 = `git archive voice-latency-baseline server` 解出到临时目录,用 lane-A 的 venv(`server/pyproject.toml`、`uv.lock` 与标签无差异)以 `python -P` + `--app-dir <解出目录>/server` 运行,`Settings()` 核对 `config.py` 来自解出目录 |
| Task 5.1 服务进程 | 端口 8022,cwd = 主工作区 `server/`(读真实 `.env`,不打印),进程环境 `UPSTREAM_ASR_MODE=chat` 或 `volc_stream`、`REGISTRATION_MODE=open`、每段一个新的临时 SQLite(`%TEMP%`,`alembic upgrade head` 后,用后删除) |
| Task 5.1 生效设置核对 | 基线重测:`upstream_asr_mode=chat`,无 `stt_max_tokens`/`stt_disable_thinking` 字段(标签代码),日志 16 × `stt_chat`、16 × `tts_volcengine stream=false`。之后(chat):`upstream_asr_mode=chat`、`stt_max_tokens=512`、`stt_disable_thinking=True`,日志 16 × `stt_chat`、32 × `tts_volcengine`(16 `stream=false` + 16 `stream=true`)、16 × `tts_volcengine_first_chunk`。之后(volc_stream):`upstream_asr_mode=volc_stream`、流式识别密钥已配置,日志 16 × `stt_volc_stream`、0 × `stt_chat`(没有回落) |
| 机器 | Windows 11 Pro 10.0.22621,Intel64 Family 6 Model 183;本机 uvicorn(单 worker),客户端与服务同机 `127.0.0.1` |
| 网络 | 本机默认网络连接上游(类型未单独记录;"之后"须在同一网络测) |
| 基线代码 | 标签 `voice-latency-baseline` = `7a4e11b1`;实际运行的工作树 lane-X `3be6ad7b`(相对标签只多了 spike 脚本与文档,`server/app`、`web/src` 无差异,`git diff --stat voice-latency-baseline 3be6ad7b` 可核对) |
| 服务进程 | `uv run uvicorn app.main:create_app --factory --port 8024 --app-dir <lane-X>/server`,cwd = 主工作区 `server/`(读取真实 `.env`,不打印),进程环境 `UPSTREAM_ASR_MODE=chat`、`REGISTRATION_MODE=open`、临时 SQLite(`%TEMP%`,`alembic upgrade head` 后) |
| 生效设置核对 | 运行前用同一环境 `Settings()` 打印 `upstream_asr_mode=chat`;运行中服务日志 16 次识别全是 `timing event=stt_chat`,`volc_stream` 出现 0 次 |
| 识别模型 | `UPSTREAM_WHISPER_MODE=chat`,方舟 `doubao-seed-2-0-lite-260428`(基线代码不带 `max_tokens`/`thinking`) |
| TTS 模型 | `volcengine/seed-tts-2.0`,音色 `en_female_dacey_uranus_bigtts`,`mp3` 24 kHz |
| LLM 模型 | 默认 `deepseek-v4-flash-vision-exp`(列表 `deepseek-v4-pro, deepseek-v4-flash-vision-exp`;浏览器层才涉及) |

## 结果

服务端层的"基线中位数"用 **Task 5.1 同日重测**的数字(16:32,与"之后"相隔 2–3 分钟);Task 0.5 的 14:54 基线列在括号里作对照。比值、达标判断由 `markdown_row` 生成,"结论"列为人工补充。

| 指标 | 样本 | 基线中位数 (ms) | 之后中位数 (ms) | 之后/基线 | 目标 | 结论 |
|---|---|---|---|---|---|---|
| 松手 → 转写出现(浏览器) | s5 | 待测:需要 Docker Desktop | PENDING: Docker Desktop | — | ≤ 50% | 未测(命令见下文"浏览器层(之后)") |
| 松手 → 转写出现(浏览器) | s15 | 待测:需要 Docker Desktop | PENDING: Docker Desktop | — | ≤ 50% | 未测 |
| 回复完成 → 开始出声(浏览器) | s5 | 待测:需要 Docker Desktop | PENDING: Docker Desktop | — | ≤ 40% | 未测;服务端层代理指标见下方 TTS 各行与"按句流水线朗读(估算)" |
| 松手 → 开始出声(浏览器) | s5 | 待测:需要 Docker Desktop | PENDING: Docker Desktop | — | 参考 | 未测 |
| 上传 → 转写(服务端,之后 = `chat`) | s5 | 5490(0.5:4366) | 1673 | 30% | 参考 | 降到约 1/3(对 0.5 基线 38%);服务端层已低于浏览器目标的 50%,浏览器层未测不能据此判达标 |
| 上传 → 转写(服务端,之后 = `chat`) | s15 | 7236(0.5:7520) | 2504 | 35% | 参考 | 同上(对 0.5 基线 33%);7 次全部 ≤ 2954,基线 7 次全部 ≥ 5826 |
| 上传 → 转写(服务端,之后 = `volc_stream`) | s5 | 5490(0.5:4366) | 972 | 18% | 参考 | 最快;对 0.5 基线 22%;离散度最小(933–1254) |
| 上传 → 转写(服务端,之后 = `volc_stream`) | s15 | 7236(0.5:7520) | 2135 | 30% | 参考 | 对 0.5 基线 28%;比 `chat` 之后再快约 15%(s15 上两种模式差距小于 s5) |
| 整段合成(服务端) | REPLY_TEXT | 738(0.5:704) | 705 | 96% | 参考 | 无实质变化(预期:整段非流式路径未改,差异在噪声内) |
| 首句合成(服务端) | 第一句 | 551(0.5:536) | 514 | 93% | 参考 | 无实质变化(同上);相对整段基线 = 514 / 738 = **70%**,这是网页端按句朗读第一句要付的合成时间 |
| 首块(服务端,`stream=true`) | REPLY_TEXT | 738(基线整段;基线无 `stream=true`) | 357 | 48% | 参考 | 首块比本次整段(流式总时长中位数 707)早约 350 ms;R6 的消费者是实时通话,网页自动朗读不走它 |
| 首句首块(服务端,`stream=true`,新增) | 第一句 | 738(基线整段) | 301 | 41% | 参考(浏览器目标 ≤ 40%) | 服务端层最好的"首次出声"代理也是 41%,**略高于 40%,按服务端层代理算未达标**;对首句非流式基线 551 为 55% |

(计划模板里"上传 → 转写 s5 / s15"与"整段 / 首句 / 首块"各合并为一行,这里拆开逐项记录;识别按 R23 把 `chat` 与 `volc_stream` 分列。"首句首块"是 Task 5.1 新增的指标:第一句、`stream=true`,即理论上的"最早可出声"时刻。)

**未达标/未验证小结(如实记录,不改目标)**:

1. 计划的两条验收目标(转写 ≤ 50%、首句出声 ≤ 40%)都是**浏览器层**指标,浏览器层在基线与之后都没有测(需要 Docker Desktop),所以两条目标**均未验证**,不能据服务端层宣布达标。
2. 转写:服务端层 `chat` 30%/35%、`volc_stream` 18%/30%,都远低于 50%。浏览器层另含上传与页面渲染开销,但这些开销与基线相同或更小(按住说话路径停止即出结果,R9 去掉了 2 s 兜底),预计浏览器层也低于 50%,**这是推断,未测**。
3. 首次出声:服务端层没有任何一条路径到 40%。网页自动朗读走"按句、非流式"合成,单看合成时间是 514 / 738 = 70%;能否到 40% 取决于第一句合成与 LLM 余下文本的重叠(见下节估算)。服务端流式首块(41–48%)只被实时通话使用。可能的原因与改进方向:火山 TTS 第一块本身约 250–370 ms(spike 直连约 330 ms),是首句出声的下限;若浏览器层实测未达标,可考虑网页端第一句改用 `stream=true` + MediaSource/WebAudio 播放(计划 R8/R33 有意没这么做)。

### 按句流水线朗读(估算,非实测)

**以下是解析估算,不是测量值**,浏览器层实测之前只作预期参考。记号:`X` = 浏览器拿到整段音频后到开始出声的开销(blob、解码、`play()`,基线与之后相同);`Δ` = 回复流中第一句完成到整条回复完成的时间(取决于 LLM 输出速度,未测)。

- 基线:回复完成 → 开始出声 ≈ 整段合成 + X ≈ **738 + X ms**。
- 之后(R8 按句流水线):第一句一完成就开始合成,开始出声 ≈ 第一句完成时刻 + 514 + X;相对"回复完成"为 **514 − Δ + X ms**(Δ > 514 + X 时为负数,即回复还没结束就已出声)。
- 比值 (514 − Δ + X) / (738 + X):取 X = 0,Δ = 0 → 70%;Δ = 219 ms → 40%;Δ ≥ 514 ms → ≤ 0。X 越大比值越接近 1,需要更大的 Δ。`REPLY_TEXT` 的第二句约 13 个词(约 15 个 token),Δ 约等于 LLM 输出这 15 个 token 的时间;若 LLM 输出速度在 30–70 token/s,Δ ≈ 210–500 ms,估算比值约 2%–41%(X = 0)。**这一区间完全依赖未测的 LLM 速度与 X,只说明"有可能达标、也可能略高于 40%"。**
- 只有一句的短回复不走流水线(回退整条朗读),基线与之后都是整条合成同一段文本,比值 ≈ 100%(没有提速,同样是估算)。

### 原始数据:服务端层(基线,N = 7,热身 1 次不计)

| 指标 | 中位数 | 最小 | 最大 | 热身 | 7 次(ms,按顺序) |
|---|---|---|---|---|---|
| `stt_ms_s5` | 4366 | 3678 | 10518 | 4116 | 4366, 4189, 4612, 3678, 5516, 10518, 3957 |
| `stt_ms_s15` | 7520 | 5679 | 7664 | 5954 | 5679, 7627, 7358, 7664, 5785, 7663, 7520 |
| `tts_full_ms` | 704 | 617 | 884 | 725 | 643, 884, 688, 617, 750, 704, 837 |
| `tts_first_sentence_ms` | 536 | 469 | 620 | 525 | 620, 536, 555, 530, 580, 469, 526 |
| `tts_first_chunk_ms`(见注) | 717 | 680 | 780 | 588 | 695, 780, 774, 717, 680, 695, 723 |

- 全部 32 次请求 HTTP 200。原始 JSON:`.superpowers/latency/baseline.json`(不提交)。
- `stt_ms_s5` 第 6 次 10518 ms 是孤立的上游慢响应(服务日志 `stt_chat ms=10513`,前后两次 5.5 s、4.0 s);中位数不受影响,"之后"若也出现同类离群值应同样照实记录。
- **注:`tts_first_chunk_ms` 在基线上不适用。** 基线代码的 `SpeechIn` 没有 `stream` 字段(Pydantic 忽略未知字段),服务日志 8 次都是 `stream=false`;响应在整段合成后一次性返回,所以这里的"第一块"= 整段响应的第一个字节(首块 = 总时长,与 `tts_full_ms` 同分布)。这一行只作"不支持透传时首字节 ≈ 整段"的对照,不能作为比值的分母;Task 5.1 的首块应与基线 `tts_full_ms`(704)比较。
- 上游调用:识别 16 次(2 样本 × 8)、TTS 24 次(3 指标 × 8)。

### 原始数据:服务端层(Task 5.1,同日基线重测与之后,N = 7,热身 1 次不计)

命令(每段单独起一个服务进程,见上文"环境"):`uv run python scripts/measure_latency.py --base-url http://127.0.0.1:8022 --label <label> --samples ../.superpowers/latency --runs 7 --metrics <列表> --out ../.superpowers/latency/<label>.json`。基线重测 `--metrics stt,tts_full,tts_first_sentence`(基线无 `stream=true`,不测首块);之后(chat)测全部 5 项;之后(volc_stream)只测 `stt`(TTS 与识别模式无关)。原始 JSON:`.superpowers/latency/baseline-rerun.json`、`after-chat.json`、`after-volc_stream.json`(不提交)。

| 段 | 指标 | 中位数 | 最小 | 最大 | 热身 | 7 次(ms,按顺序) |
|---|---|---|---|---|---|---|
| 基线重测 | `stt_ms_s5` | 5490 | 4028 | 5983 | 5192 | 4028, 5983, 4309, 5309, 5682, 5791, 5490 |
| 基线重测 | `stt_ms_s15` | 7236 | 5826 | 10188 | 8108 | 6934, 7310, 10188, 7716, 5826, 7236, 6339 |
| 基线重测 | `tts_full_ms` | 738 | 641 | 912 | 750 | 738, 841, 912, 641, 724, 758, 728 |
| 基线重测 | `tts_first_sentence_ms` | 551 | 429 | 613 | 506 | 481, 522, 551, 613, 592, 582, 429 |
| 之后 chat | `stt_ms_s5` | 1673 | 1156 | 2455 | 1871 | 1673, 1156, 1963, 1319, 1981, 2455, 1522 |
| 之后 chat | `stt_ms_s15` | 2504 | 2196 | 2954 | 2789 | 2792, 2479, 2954, 2289, 2196, 2504, 2642 |
| 之后 chat | `tts_full_ms` | 705 | 613 | 786 | 2590 | 786, 618, 705, 719, 637, 613, 774 |
| 之后 chat | `tts_first_sentence_ms` | 514 | 436 | 578 | 544 | 537, 474, 482, 576, 514, 578, 436 |
| 之后 chat | `tts_first_chunk_ms`(首块) | 357 | 249 | 369 | 261 | 369, 357, 368, 328, 358, 258, 249 |
| 之后 chat | 同上,整段完成 | 707 | 593 | 931 | 507 | 707, 683, 733, 736, 931, 611, 593 |
| 之后 chat | `tts_first_sentence_first_chunk_ms`(首块) | 301 | 253 | 352 | 249 | 301, 317, 267, 352, 253, 273, 321 |
| 之后 chat | 同上,整段完成 | 525 | 461 | 546 | 1000 | 532, 525, 469, 546, 518, 461, 528 |
| 之后 volc_stream | `stt_ms_s5` | 972 | 933 | 1254 | 1246 | 1254, 1111, 933, 972, 956, 1199, 954 |
| 之后 volc_stream | `stt_ms_s15` | 2135 | 2076 | 2496 | 2001 | 2135, 2188, 2496, 2133, 2105, 2076, 2209 |

- 全部 96 次计时请求 HTTP 200。基线重测 s15 第 3 次 10188 ms、之后 chat `tts_full_ms` 热身 2590 ms 是孤立慢响应(热身不计)。
- 同日两次基线(14:54 与 16:32)对照:`stt_ms_s5` 4366 → 5490(+26%,两次都有 4.0–6.0 s 的大离散)、`stt_ms_s15` 7520 → 7236、`tts_full_ms` 704 → 738、`tts_first_sentence_ms` 536 → 551。识别基线本身波动较大,所以比值以相隔 2 分钟的重测为分母;用 14:54 基线作分母,识别比值为 chat 38%/33%、volc_stream 22%/28%,结论不变。
- 转写内容核对(另外 4 次识别,不计入统计,只打印长度):之后 chat s5 7 词 / s15 28 词,volc_stream s5 7 词 / s15 28 词,都含样本里的关键词,不是 `<none>` 空结果——提速不是因为返回了空转写。
- 上游调用(Task 5.1):识别 52 次(3 段 × 16 + 核对 4)、TTS 48 次(基线 16 + 之后 32);预算各 60。

### 原始数据:浏览器层(之后)

**PENDING: Docker Desktop**(2026-10-07 Task 5.1 时 Docker Desktop 未运行,按 lane 规则不启动)。必须与浏览器层基线**同一天**测;届时服务端层也应在同一天按上一节命令重测三段(基线重测、之后 chat、之后 volc_stream)。在当前代码(含全部优化)上按两种识别模式各起一次 E2E 栈:

```bash
# 1. 当前代码的 E2E 栈(主工作区,feat/self-hosted-backend 合入全部 lane 之后;端口 8100)
cd /e/workspace/everyone-can-use-english
export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
for MODE in chat volc_stream; do
  E2E_UPSTREAM_ASR_MODE=$MODE docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
  # (R34:若根 docker-compose.yml 的外部网络导致起不来,先 `docker network create 1panel-network`)
  cd web
  for S in 5 15; do
    E2E_BASE_URL=http://localhost:8100 E2E_LATENCY=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s$S.wav E2E_HOLD_MS=${S}000 \
      yarn playwright test e2e/latency.spec.ts --project=chromium-mobile 2>&1 | grep LATENCY_RESULTS | tee ../.superpowers/latency/browser-after-$MODE-s$S.txt
  done
  cd ..
  docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
done

# 2. 汇总(与基线相同的一行脚本,把文件名换成 browser-after-<mode>-s5/s15.txt)
cd /e/workspace/everyone-can-use-english/server
for f in chat-s5 chat-s15 volc_stream-s5 volc_stream-s15; do uv run python -c "
import json, sys; sys.path.insert(0, 'scripts'); from measure_latency import summarize
d = json.loads(open('../.superpowers/latency/browser-after-$f.txt', encoding='utf-8').read().split('LATENCY_RESULTS ', 1)[1])
for k in ('transcriptMs', 'firstAudioAfterReplyMs', 'firstAudioAfterReleaseMs'):
    v = [r[k] for r in d['runs'] if k in r]; print('$f', k, summarize(v) if v else 'none')"; done
```

- 浏览器层之后:2 模式 × 2 样本 × 6 次 = 识别 24 次,另有 LLM 回复与按句 TTS(每条两句的回复约 2 次 TTS,共约 48 次);加上同日基线浏览器层(识别 12、TTS 约 12)与服务端层重测(识别 48、TTS 48),运行前请确认费用。
- 浏览器层填表时:"回复完成 → 开始出声"的分母是基线浏览器层中位数,目标 ≤ 40% 不变;`firstAudioAfterReplyMs` 可能为负数,照实记录(比值为负即"回复结束前已出声")。

### 原始数据:浏览器层(基线)

**待测:需要 Docker Desktop**(2026-10-07 测量时 Docker Desktop 未运行;按 lane 规则不启动 Docker)。用户启动 Docker Desktop 后,在**基线代码**上按下面的命令测(R27:Playwright 从主工作区 `web/` 运行,`E2E_BASE_URL` 指向以基线代码起的 E2E 栈;`server/.env` 复制到基线工作树用后删除,不打印):

```bash
# 1. 基线代码的 E2E 栈(在标签代码上构建;端口 8100,invite 注册,强制 chat 识别)
cd /e/workspace/everyone-can-use-english
git worktree add ../ecue-baseline voice-latency-baseline
cp server/.env ../ecue-baseline/server/.env          # 不打印内容,第 4 步删除
cd ../ecue-baseline
export E2E_INVITE_CODE=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
# (若根 docker-compose.yml 的外部网络导致起不来,按 R34 先 `docker network create 1panel-network`)

# 2. 浏览器层测量(从主工作区 web/ 运行;N = 5,热身 1 次由用例丢弃)
cd /e/workspace/everyone-can-use-english/web
E2E_BASE_URL=http://localhost:8100 E2E_LATENCY=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s5.wav E2E_HOLD_MS=5000 \
  yarn playwright test e2e/latency.spec.ts --project=chromium-mobile 2>&1 | grep LATENCY_RESULTS | tee ../.superpowers/latency/browser-baseline-s5.txt
E2E_BASE_URL=http://localhost:8100 E2E_LATENCY=1 E2E_FAKE_AUDIO=/e/workspace/everyone-can-use-english/.superpowers/latency/s15.wav E2E_HOLD_MS=15000 \
  yarn playwright test e2e/latency.spec.ts --project=chromium-mobile 2>&1 | grep LATENCY_RESULTS | tee ../.superpowers/latency/browser-baseline-s15.txt

# 3. 汇总(中位数/最小/最大)
cd /e/workspace/everyone-can-use-english/server
for s in s5 s15; do uv run python -c "
import json, sys; sys.path.insert(0, 'scripts'); from measure_latency import summarize
d = json.loads(open('../.superpowers/latency/browser-baseline-$s.txt', encoding='utf-8').read().split('LATENCY_RESULTS ', 1)[1])
for k in ('transcriptMs', 'firstAudioAfterReplyMs', 'firstAudioAfterReleaseMs'):
    v = [r[k] for r in d['runs'] if k in r]; print('$s', k, summarize(v) if v else 'none')"; done

# 4. 收尾
cd /e/workspace/ecue-baseline
docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml down -v
rm server/.env
cd /e/workspace/everyone-can-use-english && git worktree remove ../ecue-baseline
```

- 浏览器层识别 = 2 样本 × 6 次 = 12 次;每次还有 1 次 LLM 回复与 1 次 TTS(自动朗读,共约 12 次)。
- 基线须与 Task 5.1 的"之后"同一天测量(计划「延迟测量方法」);若基线浏览器层只能在另一天补测,"之后"应在同一天重测服务端层与浏览器层,并在本节注明。
