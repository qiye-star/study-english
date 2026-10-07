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
| 日期时间 | 服务端层 2026-10-07 14:54:55–14:56:48(+08:00);TTS spike 同日 14:53 |
| 机器 | Windows 11 Pro 10.0.22621,Intel64 Family 6 Model 183;本机 uvicorn(单 worker),客户端与服务同机 `127.0.0.1` |
| 网络 | 本机默认网络连接上游(类型未单独记录;"之后"须在同一网络测) |
| 基线代码 | 标签 `voice-latency-baseline` = `7a4e11b1`;实际运行的工作树 lane-X `3be6ad7b`(相对标签只多了 spike 脚本与文档,`server/app`、`web/src` 无差异,`git diff --stat voice-latency-baseline 3be6ad7b` 可核对) |
| 服务进程 | `uv run uvicorn app.main:create_app --factory --port 8024 --app-dir <lane-X>/server`,cwd = 主工作区 `server/`(读取真实 `.env`,不打印),进程环境 `UPSTREAM_ASR_MODE=chat`、`REGISTRATION_MODE=open`、临时 SQLite(`%TEMP%`,`alembic upgrade head` 后) |
| 生效设置核对 | 运行前用同一环境 `Settings()` 打印 `upstream_asr_mode=chat`;运行中服务日志 16 次识别全是 `timing event=stt_chat`,`volc_stream` 出现 0 次 |
| 识别模型 | `UPSTREAM_WHISPER_MODE=chat`,方舟 `doubao-seed-2-0-lite-260428`(基线代码不带 `max_tokens`/`thinking`) |
| TTS 模型 | `volcengine/seed-tts-2.0`,音色 `en_female_dacey_uranus_bigtts`,`mp3` 24 kHz |
| LLM 模型 | 默认 `deepseek-v4-flash-vision-exp`(列表 `deepseek-v4-pro, deepseek-v4-flash-vision-exp`;浏览器层才涉及) |

## 结果

| 指标 | 样本 | 基线中位数 (ms) | 之后中位数 (ms) | 之后/基线 | 目标 | 结论 |
|---|---|---|---|---|---|---|
| 松手 → 转写出现(浏览器) | s5 | 待测:需要 Docker Desktop | 未测 | — | ≤ 50% | — |
| 松手 → 转写出现(浏览器) | s15 | 待测:需要 Docker Desktop | 未测 | — | ≤ 50% | — |
| 回复完成 → 开始出声(浏览器) | s5 | 待测:需要 Docker Desktop | 未测 | — | ≤ 40% | — |
| 松手 → 开始出声(浏览器) | s5 | 待测:需要 Docker Desktop | 未测 | — | 参考 | — |
| 上传 → 转写(服务端) | s5 | 4366 | 未测 | — | 参考 | — |
| 上传 → 转写(服务端) | s15 | 7520 | 未测 | — | 参考 | — |
| 整段合成(服务端) | REPLY_TEXT | 704 | 未测 | — | 参考 | — |
| 首句合成(服务端) | 第一句 | 536 | 未测 | — | 参考 | — |
| 首块(服务端,`stream=true`) | REPLY_TEXT | 不适用(基线无 `stream=true`) | 未测 | — | 参考 | — |

(计划模板里"上传 → 转写 s5 / s15"与"整段 / 首句 / 首块"各合并为一行,这里拆开逐项记录,便于 Task 5.1 用 `markdown_row` 逐行填。)

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
