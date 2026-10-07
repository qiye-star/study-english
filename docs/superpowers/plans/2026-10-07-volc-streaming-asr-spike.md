# 火山大模型流式语音识别:spike 结论与接入(2026-10-07)

对应设计文档 `docs/superpowers/specs/2026-10-07-voice-speed-hold-to-talk-realtime-design.md` §3.2。

## 结论

- **鉴权可用**:现有豆包语音 UUID Key(与 TTS `seed-tts-2.0` 同一个)+ 资源 ID `volc.bigasr.sauc.duration` 可以调用。
- **上传识别选 `bigmodel_nostream`**:整段音频一次推完再出结果,准确且最快;4 s 片段中位数约 1.0 s,方舟 chat 模式约 5.0 s。
- `bigmodel` / `bigmodel_async` 是实时流式接口,不按实时节奏推送时又慢又乱(async 会把句子切得很碎),**留给实时通话模式**,上传识别不用。
- 已实现 `UPSTREAM_ASR_MODE=volc_stream`(需显式开启),失败自动回退到现有路径。

## 鉴权(实测)

| 资源 ID | 结果 |
|---|---|
| `volc.seedasr.sauc.duration` | HTTP 403 `requested resource not granted` |
| `volc.bigasr.sauc.duration` | **握手成功,能识别** |
| `volc.seedasr.sauc.concurrent` | HTTP 403 `requested resource not granted` |
| `volc.bigasr.sauc.concurrent` | 握手成功,但首帧返回错误帧 code `45000292` `quota exceeded for types: concurrency`(未购买并发版) |

请求头:`X-Api-Key: <UUID>`、`X-Api-Resource-Id`、`X-Api-Connect-Id: <uuid4>`。没有试 `X-Api-App-Key` / `X-Api-Access-Key`:不需要,而且 `Settings` 里也没有这类字段。响应头带 `X-Tt-Logid`,排查问题时有用。
如需 seed 版(`volc.seedasr.*`)识别,要在豆包语音控制台另行开通;并发版需购买并发额度。

## 协议

官方文档页(docs.volcengine.com/docs/6561/1354869)是 JS 渲染的,WebFetch 抓不到正文,所以下面的细节以**实测**为准。

**已验证**(真实服务往返成功):
- 头部 4 字节:`[0x11, msg_type<<4 | flags, serialization<<4 | compression, 0x00]`。
- 客户端完整请求:msg_type `0b0001`,JSON + gzip,4 字节大端长度后接负载。负载:`{"user":{"uid"}, "audio":{"format":"pcm","codec":"raw","rate":16000,"bits":16,"channel":1}, "request":{"model_name":"bigmodel","enable_itn":true,"enable_punc":true}}`。
- 纯音频帧:msg_type `0b0010`,序列化 none、gzip,最后一帧 flags `0b0010`;200 ms(6400 字节)分片,不等节奏直接推完,nostream 可以接受。
- 服务端完整响应:msg_type `0b1001`,flags `0b0001` 表示带 4 字节序列号,最后一条 flags `0b0011`(实测为正序号,例如 23)。**响应负载未压缩**(compression=0),虽然请求用的是 gzip;解码器两种都接受。完整请求发出后服务端立即回一条空结果(seq 1);nostream 每收到一个音频包也会回一条中间消息。
- 最终负载:`{"audio_info":{"duration":ms}, "result":{"text", "utterances":[{"text","start_time","end_time","definite","words":[...]}], "additions":{"log_id"}}}`。
- 错误帧:msg_type `0b1111`,4 字节错误码 + 4 字节长度 + JSON `{"error": "..."}`。

**未验证**(凭记忆,当前实现未依赖):
- 最后一条消息用负序号表示(解码器兼容:负序号也算最后一条)。
- `language`、`corpus`/热词、`show_utterances`、`result_type`、VAD 断句参数(`end_window_size` 等)。
- `format: "wav"` 直接发 WAV 文件头;nostream 的最长音频时长与包大小上限。
- 实时 `bigmodel` 在按实时节奏推送时的分句与 `definite` 语义——实时通话需要再做一次 spike。

## 延迟(N=5,中位数,本机直连上游,含 TLS/WS 握手)

测试音频:`seed-tts-2.0` 合成的英文,经 ffmpeg 转为 16 kHz 单声道 16 位 WAV。

| 片段 | 方舟 chat(`doubao-seed-2-0-lite-260428`) | `bigmodel_nostream` | `bigmodel` | `bigmodel_async` |
|---|---|---|---|---|
| 4.25 s | **4976 ms**(4602–11019) | **973 ms**(932–2005) | 2242 ms | 1873 ms |
| 13.3 s | **4843 ms**(4326–5301) | **2091 ms**(2030–2612) | 9451 ms | 4514 ms |

- 转写质量:nostream 与 chat 都完全正确,nostream 自带标点和大小写(例如 "Hello, World." / "Hello, world.")。
- `bigmodel_async` 在一次性推送时,长句被切成 "Yes. I. Went to. The. Market…",不可用于上传识别。
- 本地服务端到端(smoke):`asr volc_stream ok ms=895 audio_s=4.25`。用不可用的资源 ID 实测回退:`kind=auth detail=http=403 ms=175` → chat 回退成功。

## 实现

- `server/app/asr_stream.py`:
  - 帧编解码:gzip 解压后最多 4 MiB,超出或截断都算协议错误;过深的 JSON 嵌套也算协议错误。
  - `wav_to_pcm`:只接受 16 kHz、单声道、16 位,否则返回 None。
  - `transcribe_pcm(settings, pcm, uid)`:超时为 `min(ASR_STREAM_TIMEOUT_SECONDS + 音频秒数, 120)`。任何非取消类异常都会转成 `AsrStreamError`,所以总能回退。
  - `AsrStreamError.kind` ∈ {auth, quota, timeout, protocol, upstream, empty, not_configured}。`detail` 只含 HTTP 状态或上游错误码,`connect_id` 和 `logid`(`X-Tt-Logid`)用于联系厂商排查,都不含文本和密钥。
  - `AsrGate`:每进程的非阻塞并发上限(`ASR_STREAM_MAX_CONCURRENCY`,默认 3),超出的请求不连接上游,直接回退。另有熔断:连续 3 次 auth/quota 失败后,60 秒内跳过流式。
  - websockets 连接使用专用 logger,固定为 INFO,所以全局开 DEBUG 也不会打印带密钥的握手头。
- `POST /api/ai/audio/transcriptions`:
  - 当 `UPSTREAM_ASR_MODE=volc_stream`,音频是合格的 WAV,且(`UPSTREAM_WHISPER_MODE=chat`,或 `response_format` 为空/`json`)时,走流式识别并返回 `{"text", "segments": []}`。
  - 否则(包括失败、并发已满、熔断中)走 `UPSTREAM_WHISPER_MODE` 的原路径(chat / openai),Whisper 的 `verbose_json`/`text`/`srt`/`vtt` 响应保持不变。
  - 未配置回退时:不适合流式的请求返回 503 `Whisper upstream is not configured`;流式 auth 失败返回 502 `Upstream authentication failed`;其他失败(含并发已满、熔断)返回 502 `Upstream unavailable`;缺 Key 返回 503。
  - 日志:`asr volc_stream ok ms= audio_s=`、`asr volc_stream failed kind= detail= ms= audio_s= fallback= connect_id= logid=`、`asr volc_stream skipped reason=busy|breaker`、`asr chat ok ms= bytes=`。
- 配置:`UPSTREAM_ASR_MODE`(默认 `chat`)、`ASR_STREAM_URL`、`ASR_STREAM_RESOURCE_ID`、`ASR_STREAM_TIMEOUT_SECONDS`、`ASR_STREAM_MAX_CONCURRENCY`、`VOLCENGINE_ASR_KEY`(为空则用 `VOLCENGINE_TTS_KEY`)。
- `scripts/smoke.py`:传入 `--wav` 时额外检查 WAV 转写(检查 `--reference` 的首词;如果首词是数字,可能因 ITN 误报失败)。

## 评审后接受的已知限制(M3/M4)

- 内存:volc_stream 模式一次请求会同时持有请求体、音频和 PCM 的副本,单个请求最多约 4 倍上传大小(25 MB 上传约 100 MB)。chat 回退模式也会先缓冲最多 25 MB,再返回 413(原来是 18 MB + 64 KiB)。
- 18–25 MB 的合格 WAV 流式失败后回退到 chat,会得到 413 `Audio file is too large`,哪怕同一个文件在流式成功时能转写。

## 如何开启

在 `server/.env` 中加入 `UPSTREAM_ASR_MODE=volc_stream`(其余用默认值),然后重启。建议同时保留 `UPSTREAM_WHISPER_MODE=chat` 的方舟配置作为回退。
