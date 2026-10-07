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
