# 方舟 2.0-lite 语音识别(chat 模式转写)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** `/api/ai/audio/transcriptions` 增加 `chat` 模式:把上传的音频交给支持音频输入的对话模型(火山方舟 `doubao-seed-2-0-lite-260428`)转写,对外仍返回 OpenAI 风格 JSON,客户端无需改动。

**Architecture:** 新设置 `UPSTREAM_WHISPER_MODE=openai|chat`(默认 `openai`,行为不变)和 `UPSTREAM_WHISPER_MODEL`。`chat` 模式下服务端解析 multipart,把音频 base64 后以 Chat Completions 的 `input_audio` 发给上游,返回 `{"text": "...", "segments": []}`。没有分段时间戳时,客户端 `use-transcribe.tsx` 会走 `EnjoyApp.echogarden.align(音频, 文本)` 在本地对齐(已核对代码:`segmentTimeline` 为空且 `transcript` 非空时进入该分支)。

**Tech Stack:** FastAPI、httpx、respx、pytest。

## 已实测的事实(2026-10-03,真实方舟接口)

- `POST https://ark.cn-beijing.volces.com/api/v3/chat/completions`,`Authorization: Bearer <方舟 API Key>`。
- 请求:`{"model":"doubao-seed-2-0-lite-260428","messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"<base64>","format":"wav"}},{"type":"text","text":"<提示词>"}]}],"temperature":0}`。
- 响应:`choices[0].message.content` 是转写文本(同时有 `reasoning_content`、`encrypted_content`,必须丢弃,不得返回给客户端);实测 32 秒内的英文音频约 4 秒返回,文本正确。
- 官方文档(音频理解):base64 方式音频 ≤ 25 MB、时长 ≤ 120 分钟;`input_audio.format` 单独指定(文档示例 `mp3`/`wav`)。
- 该模型没有词级/分段时间戳。

## 全局约束

- 沿用 `docs/superpowers/plans/2026-10-02-self-hosted-backend.md` 的全局约束(snake_case、错误体 `{"error": msg}`、提交信息格式、Git Bash)。
- 默认行为不变:`UPSTREAM_WHISPER_MODE` 缺省为 `openai`,现有 Whisper 透传测试必须继续通过。
- 上游的 401/403 一律映射为 502 `Upstream authentication failed`(沿用 `app/upstream.py` 的现有 helper);上游其它非 2xx、网络错误、空文本 → 502 `Upstream unavailable`;**绝不把上游响应体或 `reasoning_content` 返回给客户端**。
- 不得在任何会提交的文件里写入真实密钥;不要改 `server/.env`。

---

### Task 8.1:`chat` 转写模式

**Files:**
- Modify: `server/app/config.py`, `server/app/routers/ai_audio.py`, `server/.env.example`, `server/README.md`
- Create: `server/tests/test_ai_audio_chat_mode.py`(如 `ai_audio.py` 已有的 multipart 读取逻辑需要复用,可抽到 `server/app/uploads.py`,保持行为不变,现有测试全部通过)

**Interfaces:**
- Produces: `Settings.upstream_whisper_mode: Literal["openai","chat"] = "openai"`、`Settings.upstream_whisper_model: str = ""`;`POST /api/ai/audio/transcriptions` 在 `chat` 模式下的契约:
  - 请求:multipart,字段 `file`(必需)、`language`(可选,如 `en`/`en-US`)、`model`/`response_format` 等 OpenAI 字段**忽略**。
  - 成功:200,`Content-Type: application/json`,`{"text": "<转写>", "segments": []}`。
  - 400:非 multipart、缺 `file`、音频格式不支持(`Unsupported audio format (wav or mp3)`);503:未配置(`UPSTREAM_WHISPER_BASE_URL` 或 `UPSTREAM_WHISPER_MODEL` 为空)`Whisper upstream is not configured`;413:原始音频 > 18 MiB(`Audio file is too large`,保证 base64 后 ≤ 25 MB);502:上游问题(见全局约束)。

- [ ] **Step 1: 写失败测试**(respx 模拟 `https://ark.test/api/v3/chat/completions`,`settings_overrides` 里设置 `upstream_whisper_mode="chat"`、`upstream_whisper_base_url="https://ark.test/api/v3"`、`upstream_whisper_key="ark-secret"`、`upstream_whisper_model="doubao-seed-2-0-lite-260428"`):
  1. 成功:上传 RIFF/WAVE 头的小音频 → 200,`{"text":"hello world","segments":[]}`(上游返回的 `content` 带首尾空白,应被 strip);断言上游收到的请求:`Authorization == "Bearer ark-secret"`、`model` 正确、`temperature == 0`、`messages[0].content[0].type == "input_audio"`、`input_audio.format == "wav"`、`input_audio.data` 是上传字节的 base64、第二段 `type == "text"` 且包含 "verbatim"。
  2. 响应里的 `reasoning_content`、`encrypted_content` 不会出现在返回给客户端的响应中。
  3. MP3(`ID3` 头或 `\xff\xfb` 帧头)→ `format == "mp3"`;其它魔数(如随机字节)→ 400 `Unsupported audio format (wav or mp3)`,不调用上游。
  4. `language="en-US"` → 提示词里包含语言提示(如 "en"),不传则没有。
  5. 超过 18 MiB(`monkeypatch` 把常量改小)→ 413,不调用上游。
  6. 上游 401 和 403 → 502 `Upstream authentication failed`;上游 500、连接错误(`httpx.ConnectError`)、`content` 为空/缺失、`choices` 为空 → 502 `Upstream unavailable`;所有这些响应体都不含上游文本(用一个带 `secret-upstream-text` 的上游响应断言)。
  7. 未配置:`upstream_whisper_model=""` 或 `upstream_whisper_base_url=""` → 503;未登录 → 401;非 multipart → 400;缺 `file` → 400。
  8. 默认 `openai` 模式行为不变(现有 `test_ai_audio.py` 的 Whisper 用例全部继续通过,不要修改它们)。
  9. Settings 默认值:`upstream_whisper_mode == "openai"`、`upstream_whisper_model == ""`。
- [ ] **Step 2: 运行,确认失败**:`cd server && uv run pytest tests/test_ai_audio_chat_mode.py -q`。
- [ ] **Step 3: 实现**。提示词固定为:`"Transcribe the audio verbatim in its original language. Output only the transcript text, without any extra words, quotes or timestamps."`,有语言时追加 `" The audio language is <primary subtag of language>."`;超时 `httpx.Timeout(300, connect=10)`;音频格式用魔数判断(`RIFF....WAVE` → wav;`ID3` 或首字节 `0xFF` 且次字节高 3 位为 1 → mp3);复用现有的 multipart 解析/上传限制写法,不重复造轮子。
- [ ] **Step 4: 运行全量测试**:`cd server && uv run pytest -q` → 0 failed。
- [ ] **Step 5: 文档**:`server/.env.example` 增加两个变量(默认值不变),`server/README.md` 的「上游服务选择」里增加方舟示例:`UPSTREAM_WHISPER_MODE=chat`、`UPSTREAM_WHISPER_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`、`UPSTREAM_WHISPER_MODEL=doubao-seed-2-0-lite-260428`,并说明:转写由大模型完成,没有时间戳(客户端在本地对齐),可能做少量润色;音频 ≤ 18 MiB;方舟 Key 与「豆包语音」控制台的 UUID 格式 Key 不是同一种,不能混用。
- [ ] **Step 6: 提交**

```bash
git add server/ docs/superpowers/plans/2026-10-03-ark-chat-transcription.md
git commit -m "feat(server): transcribe via a chat model with audio input (Ark doubao-seed-2-0-lite)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
