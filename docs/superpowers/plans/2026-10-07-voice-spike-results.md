# 语音提速 spike 结论(计划 2026-10-07-voice-speed-hold-to-talk-realtime,阶段 0)

## 1. 连通性与识别参数(Task 0.3)

结论:**通过(2026-10-07)**。上游调用:识别 16 次、TTS 1 次(R20 预算:Task 0.3–0.5 合计识别 ≤ 30、TTS ≤ 40;余识别 14、TTS 39)。

- 日期:2026-10-07;TTS 预检:`200`(本机 uvicorn,lane-X 代码,`POST /api/ai/audio/speech`,`volcengine/seed-tts-2.0`,一句话 63 KB `audio/mpeg`,1.25 s);识别预检:`200`(即下表 baseline 第 1 次)。
- 识别:`UPSTREAM_WHISPER_MODE=chat`,模型 `doubao-seed-2-0-lite-260428`(密钥、地址只确认"已配置",不记录)。直连上游 `/chat/completions`,`temperature: 0`,提示词 = Task 1.2 计划的提示词(含"只转写最近、最清晰的说话人"与 `<none>`)。
- 样本:`s5.wav`(Task 0.2 工具生成,JFK 前 5 s,16 kHz 单声道),四个变体轮转执行 3 轮(避免某个变体集中落在慢时段)。脚本:`server/scripts/spikes/stt_params_spike.py`。

  | 变体 | 状态码 ×3 | 中位数 (ms) | 三次 (ms) | completion / reasoning tokens |
  |---|---|---|---|---|
  | baseline | 200, 200, 200 | 4110 | 3860, 5266, 4110 | 69–122 / 62–114 |
  | max_tokens (512) | 200, 200, 200 | 4435 | 4435, 4529, 3363 | 74–111 / 67–103 |
  | no_thinking | 200, 200, 200 | 2363 | 2879, 1799, 2363 | 8 / 0 |
  | both | 200, 200, 200 | 2174 | 2174, 2148, 2501 | 8 / 0 |

  - `thinking: {"type": "disabled"}` **被接受**,且确实关闭了推理(`reasoning_tokens` 从 62–114 降到 0),中位数约 **−45%**(4110 → 2174–2363 ms)。转写全部一致(`and so my fellow americans ask not`,仅大小写有差异)。
  - `max_tokens: 512` 被接受;对 5 s 样本没有可测的提速(输出远小于上限,差异在噪声内),它的作用是给异常输出封顶。

- `<none>` 指令(变体 `both`,即 `max_tokens: 512` + `thinking: disabled`):

  | 样本 | 状态码 | 耗时 (ms) | 输出 | 严格 `<none>`? |
  |---|---|---|---|---|
  | 2 s 数字静音 | 200 | 1467 | `<none>` | 是 |
  | 2 s 高斯白噪声(σ = 300,约 −41 dBFS) | 200 | 1677 | `<none>` | 是 |
  | 双人:JFK 前景 + TTS 女声 −12 dB 叠加 | 200 | 1872 | `and so my fellow americans ask not` | —(只转写了前景,背景被忽略) |
  | 双人:JFK + TTS 女声等响度叠加 | 200 | 2343 | `Hello the weather tomorrow will be sunny with a light breeze in the afternoon` | —(只转写了一个说话人:更"干净"的合成声,而不是 JFK) |

  - 纯静音/纯噪声:严格输出 `<none>`(无引号、无多余文字),R4 的服务端匹配(去空白、忽略大小写)足够。
  - 背景人声低 12 dB:按提示词只转写前景。等响度两人:模型只挑一个说话人转写(本例挑了更清晰的合成声),不会把两人混写;"谁是前景"在等响度时不可控——这与 R10 的设置面板说明("无法完全排除旁人声音")一致,网页端的能量门限/混音提示仍有必要。
  - 未测:开启推理(baseline)时的 `<none>` 行为;真实环境噪声(非白噪声)与真人背景对话。

- 决定:`STT_DISABLE_THINKING` 默认 = **true**(no_thinking 变体 3/3 返回 200 且明显更快);`STT_MAX_TOKENS` 默认 512 保留(被接受、无副作用)。Task 1.2 按 R5 原样实现,`.env.example` 不需要写 `false`。

## 2. 实时节奏流式识别(Task 0.4,按 R21/R22 缩减)

结论:**通过(2026-10-07)——`realtime_asr_mode=stream` 可行**。上游调用:识别 9 个连接(合计约 77 s 音频)、TTS 0 次(R20 预算余:识别 5、TTS 39)。

- 鉴权与帧协议沿用 `2026-10-07-volc-streaming-asr-spike.md`(已验证,本次未改):`X-Api-Key`(`Settings.asr_stream_key`)+ `X-Api-Resource-Id: volc.bigasr.sauc.duration` + `X-Api-Connect-Id`;帧编解码直接用 `app.asr_stream` 的 `encode_full_request` / `encode_audio` / `decode_frame`(音频帧无序号),**9/9 连接握手成功,无一错误帧**。
- 方法:`server/scripts/spikes/asr_realtime_spike.py`。16 kHz PCM 按 100 ms(3200 字节)一块、按**绝对时间表**实时推送(第 i 块在 t0 + i×0.1 s 发出),语音后接 2 s 数字静音,最后一块带"最后一包"标志。时间一律相对 t0 = 第一块音频发出的时刻。样本 `s5.wav`(JFK 前 5 s,能量法估计语音结束 ≈ 4420 ms;服务端给出的语音起点 102–382 ms),另有一次 `s15.wav`。连接耗时 161–206 ms。

### 2.1 实测(已验证)

| run | 端点 | 请求参数(在 `model_name/enable_itn/enable_punc` 之外) | 首个 partial (ms) | partial 更新(次 / 间隔中位数 ms) | 服务端断句 `definite`(出现时刻 ms) | 最后一包 → 最终 (ms) | 最终文本 |
|---|---|---|---|---|---|---|---|
| a_default | `bigmodel_async` | `show_utterances` | 1064 | 7 / 404 | 只在最后一包后(6991) | 81 | And so my fellow Americans. Not. |
| a_ew800_single | `bigmodel_async` | + `result_type: single`, `end_window_size: 800` | 1119 | 7 / 387 | 3132、5221 | 92 | **空串**(single 的最后一帧不带全文) |
| a_ew800_two(两段语音,间隔 1.5 s) | `bigmodel_async` | + `end_window_size: 800` | 1057 | 13 / 611 | 3117、5197、9700、11704 | 79 | 两段全文累计 |
| a_nonstream | `bigmodel_async` | + `end_window_size: 800`, `enable_nonstream: true` | 1122 | 9 / 322 | 3267、5382 | 73 | And so, my fellow Americans.  Not. |
| a_nonstream(s15) | `bigmodel_async` | 同上 | 1089 | 27 / 346 | 3343、5338、14468 | 80 | …What your country can do for you, ask what… |
| b_default | `bigmodel` | `show_utterances` | 1101 | 7 / 352 | 只在最后一包后(7007) | 92 | And so my fellow Americans. Not. |
| a_silence(3 s 纯静音) | `bigmodel_async` | + `end_window_size: 800` | —(无任何文本) | 0 | 无 | 68 | 空串,正常结束,无错误 |
| conc_1 / conc_2(同时两路,2 s 语音 + 1 s 静音) | `bigmodel_async` | + `end_window_size: 800` | 1063 / 1094 | 5 / 336–340 | 2795 / 2811 | 76 / 85 | 两路都正常 |

- **首个 partial**:第一块音频后 1.06–1.12 s(语音起点之后约 0.7–1.0 s),各配置无差别。完整请求发出后约 60 ms 先回一条空结果(async 无序号;`bigmodel` 为 seq 1)。
- **partial 节奏**:`bigmodel_async` 只在文本变化时下发(70 块音频 → 11 条响应),更新间隔中位数 320–610 ms,单词级增长;`bigmodel` 每收到一块就回一条(70 块 → 71 条),文本与时延和 async 相同——**async 更省带宽和解码**。
- **最后一包 → 最终结果(带"最后"标志的响应)**:**68–92 ms**(9/9),与配置无关。最终帧序号为正数且 flags 带 last 位(与已落地的解码器一致)。
- **服务端断句**:
  - 不传 `end_window_size`:**不断句**,唯一的 utterance 直到最后一包之后才 `definite`。
  - `end_window_size: 800`:**会断句**,`definite` 出现在语音结束后约 800 ms + 50–100 ms(例:能量法语音结束 4420 → `definite` 5197–5221);JFK 句中约 0.8 s 的停顿("Americans … ask not")也被切开——也就是说服务端 VAD 会把**一个用户回合切成多段**。
  - 加 `enable_nonstream: true`(二遍识别):`definite` 再晚约 150–370 ms(3117 → 3267–3343;5197 → 5338–5382),但 definite 的文本被重写得更好:补逗号("And so, my fellow Americans."),纠错("Watch your country" → "What your country")。最后一包 → 最终的时延不受影响(73–80 ms)。
- **`result_type`**:默认(full)时每帧 `result.text` 是**整个连接的累计全文**,`utterances` 列出全部分段;`single` 时只给当前分段,且**最后一帧 `text` 为空**——用 single 必须自己拼接 definite 分段,没有好处。
- **纯静音**:没有任何文本帧,最后一包后 68 ms 正常结束(空文本,无错误码)。
- **并发 / 错误码**:同一 key 在 `duration` 资源上**同时 2 路**均成功;9 个连接**未出现任何错误帧**,`45000292` 未复现(已知只出现在 `volc.bigasr.sauc.concurrent` 资源上,见上一份 spike)。
- **识别质量**:所有 9 次(两个端点、有无二遍)都把 "ask not" 识别成 "Not."——丢了 "ask";Task 0.3 的方舟 chat 模式同一片段输出 "ask not"。流式一遍结果有明显错词("Watch your country"),二遍可纠正部分。
- 拼接细节:开启二遍后全文的分段之间出现双空格(分段文本带前导空格),取用前需归一空白。

### 2.2 未验证(只凭文档/记忆,未实测)

- `force_to_speech_time`、`vad_segment_duration`、`end_window_size` 的取值下限/上限及其他取值(只测了 800)。
- 发送**空的**最后一包(0 字节 PCM + last 标志)是否被接受——本次的最后一包都是 100 ms 静音块。
- 单个连接的最长时长 / 空闲超时(最长只测了 17 s 连接、2 s 连续静音)。
- `duration` 资源的并发上限(只测了 2 路;R15 全局 5 路通话 + 上传识别 `ASR_STREAM_MAX_CONCURRENCY=3` 同时在用时可能更多)。
- 丢 "ask" 是流式模型的普遍问题还是这一片段的特例(JFK 录音里 "ask" 很轻);中文/中英混说、真实麦克风噪声。
- 客户端按 VAD 只上传说话部分(R15)时,服务端对"不连续"的音频的表现(本次音频是连续的)。

### 2.3 结论与 Task 1.6(`server/app/asr_realtime.py`)参数

- **`realtime_asr_mode=stream` 可行:是**。首个 partial ≈ 1.1 s,partial 每 0.3–0.6 s 更新,客户端 `utterance_end` → 发最后一包 → 最终结果 **≤ 100 ms**,比 buffered(上传识别 nostream 4 s 片段中位数约 1.0 s、chat 约 2.2 s)明显快。
- 推荐参数(全部已在本 spike 实测通过):
  - URL `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`(= R21 的 `asr_realtime_url` 默认值);资源 `volc.bigasr.sauc.duration`(复用 `asr_stream_resource_id`);鉴权头同 `asr_stream`(`X-Api-Key` = `asr_stream_key`、`X-Api-Resource-Id`、`X-Api-Connect-Id`)。
  - 完整请求:`{"user": {"uid": …}, "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}, "request": {"model_name": "bigmodel", "enable_itn": true, "enable_punc": true, "show_utterances": true, "enable_nonstream": true, "end_window_size": 800}}`;**不传 `result_type`**(默认 full)。
  - 音频:客户端上行 PCM 收到即转发(`encode_audio(chunk, False)`,每块 ≤ 32000 字节;本次实测 100 ms 块);回合结束(客户端 `utterance_end`,R12)时发一块 100 ms 静音并带 last 标志(`encode_audio(bytes(3200), True)`;空包未验证,不要用)。
  - 结果:每条非最后响应的 `result.text`(空白归一后)→ `transcript_partial`(文本没变就不发);带 last 标志的响应的 `result.text` → `transcript_final`;为空(纯静音)→ 空转写(R13:不保存、不回复)。**回合边界以客户端 `utterance_end` 为准**,服务端 `definite` 只用于展示(800 ms 窗口会把一句话中间的停顿切开)。
  - 一个回合一个上游连接(连接 160–210 ms,可在 VAD 判定开始说话时就建立);错误帧 `45000292` 或含 "quota" → `AsrError`(配额),HTTP 401/403 → 鉴权错误,沿用 `asr_stream` 的分类,由 R21 映射为 `AsrError`。
- 风险(写给 Task 1.6 / 真机清单):流式识别的准确度低于 chat/nostream(本片段丢词),而 R14 用转写作评测参考文本;若真机上错词明显,可在 `transcript_final` 之后用该回合的 PCM 走一次上传识别(nostream,约 1 s)校正——这是后续优化,不在 Task 1.6 范围内。

## 3. TTS 分块(Task 0.5)

结论:**通过(2026-10-07)**。火山单向 TTS 是真正的分块流式返回;`pcm` 24 kHz 可用(原始 PCM16LE,无文件头,按请求的采样率输出)。上游调用:TTS 12 次(spike 11 + 字节序核对 1)、识别 0 次;另有基线测量(见 `2026-10-07-voice-latency.md`)识别 16 次、TTS 24 次。本任务合计识别 16、TTS 36(预算:各 60)。

- 方法:`server/scripts/spikes/tts_chunk_spike.py` 直连 `volcengine_tts_url`(`X-Api-Resource-Id: seed-tts-2.0`,音色 `en_female_dacey_uranus_bigtts`,密钥只确认"已配置"),`httpx` 流式读取,逐个解析拼接的 JSON 帧;"首块"= 第一个含音频 `data` 的帧被完整解析出来的时刻(相对请求发出)。`mp3` 与 `pcm` 交替执行;`REPLY_TEXT`(2 句)各 3 次,长文本(4 句约 60 词,约 18–21 s 音频)各 2 次,另 1 次 `pcm` 16000 Hz 交叉验证。原始输出 `.superpowers/latency/tts_spike.json`(不提交)。

| 文本 | 格式 | 状态码 | 首块 (ms) 中位数(范围) | 整段 (ms) 中位数(范围) | 块数 | 块大小中位数 | pcm 实测采样率 |
|---|---|---|---|---|---|---|---|
| REPLY_TEXT | mp3 24 kHz | 200 ×3 | 332(326–454) | 641(604–780) | 10(9–11) | 3264 B(≈ 0.41 s @ 64 kbps) | —(帧头:MPEG-2 Layer III,24000 Hz,64 kbps,音频 3.62–4.03 s) |
| REPLY_TEXT | pcm 24 kHz | 200 ×3 | 396(378–398) | 710(638–745) | 12(11–13) | 19198 B(≈ 0.40 s) | 24000(按 24 kHz 计 3.98–4.77 s,与 mp3 时长一致;见下) |
| 长文本 | mp3 24 kHz | 200 ×2 | 262(260–264) | 1891(1788–1993) | 48(45–51) | 3072–3264 B | —(音频 18.2–20.7 s) |
| 长文本 | pcm 24 kHz | 200 ×2 | 283(243–322) | 1761(1727–1795) | 44.5(44–45) | 19198 B | 24000(按 24 kHz 计 17.8–18.0 s) |
| REPLY_TEXT | pcm 16 kHz | 200 ×1 | 235 | 505 | 9 | 12288 B(≈ 0.38 s) | 16000(按 16 kHz 计 3.39 s) |

- **响应形态**:`200`,`content-type: text/plain; charset=utf-8`,正文是拼接的 JSON 帧(`{"code":0,"data":"<base64>"…}`),最后一帧 `code: 20000000` 且不带音频;HTTP 头与第一块几乎同时到达(mp3 头 ≈ 首块;pcm 头早于首块 0–45 ms)。
- **节奏**:每块约 **0.4 s 音频**,块间隔中位数 **30–34 ms**(最大 84 ms)——约 12 倍实时速度生成;块数随文本长度线性增长,首块时间与文本长度无关(长文本首块反而略早,在 243–322 ms,属于网络/上游波动)。
- **首块 vs 整段**:两句的 `REPLY_TEXT` 差 **约 310 ms**(mp3 332 → 641;pcm 396 → 710),刚好达到 ≥ 300 ms 的门槛;四句长文本差 **约 1.5 s**(262 → 1891;283 → 1761)。差值随回复长度增长。
- **pcm 采样率**:同一请求只能看字节数,而合成的韵律每次不同(同一文本 mp3 时长在 3.62–4.03 s、18.2–20.7 s 间波动 ±10%),所以按"字节 / 2 / 时长"只能把采样率确定到 ±10%:按 24000 解释,pcm 时长落在 mp3 的波动范围内(3.98–4.77 s vs 3.62–4.03 s;17.8–18.0 s vs 18.2–20.7 s);若上游忽略 `sample_rate` 总给 24 kHz,16 kHz 请求就只有 2.26 s,不可能;16 kHz 请求按 16 kHz 解释为 3.39 s,合理 → **`sample_rate` 被遵守**。22050 与 24000 相差 9%,在韵律波动之内,**未能用时长区分**;mp3 帧头明确是 24000 Hz,按同一参数推断 pcm 也是 24000(未做听感核对,写进 Task 4.4 的验收:按 24 kHz 播放音高正常)。
- **pcm 字节格式**:无 `RIFF` 头(原始样本);所有块大小都是偶数、累计边界从不落在半个样本上(首块恰为 16000 或 18000 字节);**字节序 = 小端**(另 1 次 `pcm` 24 kHz 请求:按 LE 解释相邻样本差均值 459、峰值 16154;按 BE 解释 17247、峰值 32767 削顶 → LE 正确)。实时通话下行(R12 = 24 kHz PCM16LE)可直接转发上游块,不需要转码或重采样;仍建议 Task 4.4 对奇数长度块做防御性拼接(本次未出现)。
- 结论:首块明显早于整段(两句时 ≈ 310 ms,四句时 ≈ 1.5 s,差值 ≥ 300 ms)→ **`stream=true` 透传值得做(R6)**,对多句回复收益更大;实时通话下行格式 = **`pcm` 24 kHz**,Task 4.4 的 **`REALTIME_TTS_SAMPLE_RATE = 24000`**(请求 `audio_params: {"format": "pcm", "sample_rate": 24000}`)。
- 未验证:pcm 24000 与 22050 的严格区分(听感);中文文本与其他音色的分块大小;上游并发多路时的首块时间;中途断流时的错误帧形态。

## 7. 结论与决定(Task 0.6)

本节汇总第 1–3 节(Task 0.3–0.5)与 `2026-10-07-voice-latency.md` 的数字,给后续任务分支用(R22 改写了计划原文的"决定"表:上传识别与通话识别分开决定)。日期 2026-10-07。本节是新增的独立章节(编号 7),不改动第 1–3、5 节,以免与主线合并冲突。

### 7.1 决定

| 决定 | 值 | 依据 |
|---|---|---|
| 上传识别(录音文件) | `UPSTREAM_ASR_MODE=volc_stream`(`bigmodel_nostream`,已建成,R21 原样保留) | 基线(强制 chat,R23)s5 服务端 4366 ms(N=7,范围 3678–10518)、s15 7520 ms;nostream 对 4 s 片段中位数约 0.9–1.0 s(来自上一份 `volc-streaming-asr-spike`,第 2.3 节引用;本次 spike 未重测 s5)。s5 估计 4366 → 约 900–1000 ms(≈ −77%) |
| 实时通话识别 `REALTIME_ASR_MODE` | **`stream`**(Task 1.6 执行);`buffered` 作兜底 | 第 2 节:`bigmodel_async` 9/9 连接成功、无错误帧;首个 partial 1.06–1.12 s,partial 间隔中位数 0.3–0.6 s,最后一包 → 最终 **68–92 ms**(9/9);同 key 同时 2 路正常。条件:真机核对准确度(见 7.3 第 1 项),若错词明显则切 `buffered`(用 volc_stream 上传识别约 1 s) |
| `STT_DISABLE_THINKING` 默认值 | **true**(`STT_MAX_TOKENS=512` 保留) | 第 1 节:`thinking: disabled` 3/3 返回 200,reasoning tokens 62–114 → 0,s5 中位数 4110 → 2363 ms(仅 no_thinking)/ 2174 ms(与 max_tokens 合用),约 −45%;`<none>` 对 2 s 静音、2 s 白噪声严格输出(1467 / 1677 ms);`max_tokens: 512` 被接受,对 5 s 样本无可测提速,只作异常输出封顶。`.env.example` 不写 `false` |
| 下行 TTS 透传 | **`stream=true` 透传值得做**(R6) | 第 3 节:首块 mp3 332 ms / pcm 396 ms,整段 641 / 710 ms,两句时差约 310 ms(门槛 ≥ 300 ms);四句长文本首块 262–283 ms,整段 1761–1891 ms,差约 1.5 s,差值随回复长度增长 |
| 实时下行 TTS 格式 | **`pcm`,24000 Hz**,`REALTIME_TTS_SAMPLE_RATE=24000` | 第 3 节:`sample_rate` 被遵守(16 kHz 请求时长合理);原始 PCM16LE、无头、字节序小端(LE 平均相邻差 459 vs BE 17247);块约 0.4 s、间隔 30–34 ms,可直接转发。**听感核对待做**(见 7.3 第 2 项) |
| 阻塞项 | 浏览器层延迟基线待 Docker Desktop(其余无阻塞) | `2026-10-07-voice-latency.md`:浏览器层基线行均为"待测:需要 Docker Desktop"(R20 允许上游,但 lane 规则不启动 Docker) |

### 7.2 验收目标与可行性

设计文档的目标不变,仍作为 Task 5.1 的验收目标:**松手 → 转写出现 ≤ 基线的 50%;回复完成 → 开始出声 ≤ 基线的 40%**。浏览器层基线未测,以下只能按已测的服务端层数字判断"是否有可能",不是结论:

| 目标 | 已有数字推算 | 判断 |
|---|---|---|
| 转写 ≤ 50%(上传识别) | STT 服务端 hop:s5 4366 → ≈ 1000(volc_stream,−77%);chat + no_thinking 约 2.2–2.4 s(−45% 到 −50%,单独不稳妥达标)。s15 基线 7520,no_thinking 未在 s15 上测 | **可能达标**:走 volc_stream 时 STT hop 单独就远低于 50%;浏览器层还包含上传、录音收尾,总比例会比 hop 比例高,需实测。仅靠 chat + no_thinking 不能保证 |
| 转写(实时通话) | 最后一包 → 最终 68–92 ms,说话期间已在出 partial | 通话回合的"松手后等待"几乎只剩 VAD 收尾 + 约 0.1 s,远优于上传路径(无直接可比基线) |
| 开始出声 ≤ 40%(回复完成 → 出声) | 服务端首块 332 / 396 ms vs 基线整段 704 ms = 47% / 56%(两句);四句长文本 262–283 ms vs 整段 1.8–1.9 s ≈ 14–15%;基线 `首句合成` 536 ms | **两句短回复在服务端层达不到 40%**;多句回复可达标。浏览器层若按句分段播放(首句先出声)与 `stream=true` 叠加,需实测;若短回复实测在 40–55%,应在 Task 5.1 如实记录而不是改写目标 |

### 7.3 未决项(进验收清单)

1. **流式识别准确度**:`bigmodel_async` 9/9 次把 "ask not" 识别成 "Not."(丢 "ask"),chat 模式同一片段正确;R14 用转写作评测参考,错词会影响评测。需真机/真实麦克风(含中文与中英混说、噪声)核对;必要时回合结束后用 PCM 走一次上传识别(nostream,约 1 s)校正,或切 `buffered`。
2. **22050 vs 24000**:两者差 9%,在韵律波动内,时长法区分不开;mp3 帧头明确 24000 Hz,pcm 也按 24000 推断。需听感核对(按 24 kHz 播放音高正常)。
3. **空的最后一包**(0 字节 PCM + last 标志)是否被接受:未验证;Task 1.6 用 100 ms 静音块带 last 标志,不要用空包。
4. **单连接最长时长 / 空闲超时**:最长只测了 17 s 连接、2 s 连续静音;`end_window_size`、`force_to_speech_time`、`vad_segment_duration` 只测了 800 一个取值。
5. **并发上限**:`duration` 资源只测了 2 路同时;R15 的 5 路通话 + 上传识别 `ASR_STREAM_MAX_CONCURRENCY=3` 同时在用时可能超过 2,需测 > 2 路(以及 TTS 多路并发下的首块时间)。
6. **客户端只上传说话部分**(R15)时服务端对不连续音频的表现(spike 音频是连续的)。
7. **真机 iOS**:Safari 上 VAD(ORT 1.30.0 + Silero v5)、共享 AudioContext、PCM 播放均未在真机验证(第 5 节只有单测与构建)。
8. **浏览器层延迟基线**:待 Docker Desktop;执行命令见 `2026-10-07-voice-latency.md`。基线与"之后"须同日测量;`UPSTREAM_ASR_MODE` 基线强制 chat,"之后"测 chat 与 volc_stream 两遍(R23)。
9. TTS 其他:中文文本与其他音色的分块大小、中途断流的错误帧形态。
10. 开着推理(无 no_thinking)时的 `<none>` 行为,以及真实环境噪声/真人背景对话下的 `<none>` 与前景选择(第 1 节)。

上游调用累计(R20 预算内):识别 25 次(0.3 的 16 + 0.4 的 9 个连接)+ 基线 16 次;TTS 36 次(0.5 的 12 + 基线 24)。本任务未新增上游调用。
