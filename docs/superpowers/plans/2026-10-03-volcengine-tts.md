# 豆包语音合成(火山 V3)TTS 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** 让客户端的语音合成走自建后端,后端调用火山「豆包语音合成大模型」(`seed-tts-2.0`),不再依赖 Azure。

**Architecture:** 后端 `/api/ai/audio/speech` 新增模型前缀 `volcengine/`(如 `volcengine/seed-tts-2.0`),调用火山 V3 HTTP Chunked 接口,把返回的 base64 音频块拼成 MP3 返回。配置接口下发 `volcengine` 音色分组,并把预设里的 TTS 模型/音色改写成已配置的。客户端:TTS 分发改为「azure 走 Azure SDK,其余走服务端」,切换到 volcengine 模型时重置音色,默认角色改用新音色。

**Tech Stack:** FastAPI、httpx、respx、pytest;客户端 TypeScript。

## 已实测的事实(2026-10-03,真实接口,UUID 格式的豆包语音 API Key)

- `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`(HTTP Chunked)。
- 请求头:`X-Api-Key: <豆包语音 API Key>`、`X-Api-Resource-Id: seed-tts-2.0`(或 `seed-tts-1.0`)、`Content-Type: application/json`。
- 请求体:`{"user":{"uid":"<任意字符串>"},"req_params":{"text":"...","speaker":"<音色>","audio_params":{"format":"mp3","sample_rate":24000}}}`。
- 成功:HTTP 200;响应体是**连续拼接的多个 JSON 对象**(不保证按行分隔,实测可用 `json.JSONDecoder.raw_decode` 逐个解析):`{"code":0,"message":"","data":"<base64 音频块>"}` ……,最后 `{"code":20000000,"message":"ok","data":null}` 表示结束。可能夹杂 `data` 为 null 的文本/`sentence` 对象,忽略即可。把所有 `data` 解码后按顺序拼接就是完整 MP3(实测以 `ID3` 开头)。
- 失败:服务未开通时 HTTP 403,体为 `{"header":{"reqid":"...","code":45000030,"message":"[resource_id=...] requested resource not granted"}}`。刚开通后几分钟内可能仍返回未授权(已见过一次)。
- 已验证可用的 2.0 英文(美式)音色:`en_male_tim_uranus_bigtts`(Tim)、`en_female_dacey_uranus_bigtts`(Dacey)、`en_female_stokie_uranus_bigtts`(Stokie)。
- 客户端调用约定(已读代码):`use-speech.tsx` 用 OpenAI SDK 发 `{model: model.replace("openai/",""), input, voice}` 到 `${apiUrl}/api/ai/audio/speech`;音色下拉框读 `ttsProviders.enjoyai.voices[model.split("/")[0]]`,元素为 `{label, value, language}`(`language` 与当前学习语言如 `en-US` 比较)或字符串。

## 全局约束

- 沿用 `docs/superpowers/plans/2026-10-02-self-hosted-backend.md` 的全局约束(snake_case、错误体 `{"error": msg}`、提交信息格式、Git Bash)。
- 现有的 `azure/speech` 与 `openai/*` 行为与测试保持不变。
- 上游 401/403(含火山 403「resource not granted」)一律映射为 502 `Upstream authentication failed`(沿用 `app/upstream.py` 的 helper);其它上游错误、网络错误、没有音频数据 → 502 `Upstream unavailable`;不得把上游响应体返回给客户端;日志里不得出现密钥。
- 不得在会提交的文件里写入真实密钥;不要改 `server/.env`。
- 客户端:`tsc` 错误行与基线(37 条)保持一致;不启动图形界面。

---

### Task 9.1:服务端 `volcengine/*` TTS

**Files:**
- Modify: `server/app/config.py`, `server/app/routers/ai_audio.py`, `server/.env.example`, `server/README.md`
- Create: `server/app/volcengine.py`(流解析与请求,保持 `ai_audio.py` 精简), `server/tests/test_volcengine_tts.py`

**Interfaces:**
- Produces:
  - `Settings.volcengine_tts_key: str = ""`、`Settings.volcengine_tts_url: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"`
  - `async def synthesize(http: httpx.AsyncClient, url: str, api_key: str, resource_id: str, text: str, speaker: str, uid: str) -> bytes`(失败抛 `VolcengineError(kind: "auth"|"upstream")`)
  - `def parse_stream(raw: bytes) -> bytes`(把拼接的 JSON 对象流解析为 MP3 字节;没有任何音频数据 → `VolcengineError("upstream")`)
  - `/api/ai/audio/speech`:`model` 以 `volcengine/` 开头且在 `TTS_MODELS` 内 → 资源 ID = 前缀之后的部分,且只接受 `seed-tts-1.0`、`seed-tts-2.0`、`seed-tts-1.0-concurr`;`voice` 必须匹配 `^[A-Za-z0-9_]{3,100}$`(否则 400 `Invalid voice`);`input` 超长沿用现有 4096 限制;未配置 `volcengine_tts_key` → 503 `Volcengine TTS is not configured`;成功返回 `audio/mpeg`。

- [ ] **Step 1: 写失败测试**(respx 模拟 `https://volc.test/api/v3/tts/unidirectional`;`settings_overrides` 设置 `volcengine_tts_key="volc-secret"`、`volcengine_tts_url="https://volc.test/api/v3/tts/unidirectional"`、`tts_models="openai/tts-1,azure/speech,volcengine/seed-tts-2.0"`):
  1. 成功:上游返回三段连续 JSON(中间一段 `data:null`,最后 `{"code":20000000,...}`),三个 JSON 对象之间既用换行分隔、也有一个用**无分隔直接相连**的情形(两个用例);响应 200、`audio/mpeg`,内容为各块 base64 解码后拼接;断言上游收到的请求头 `X-Api-Key == "volc-secret"`、`X-Api-Resource-Id == "seed-tts-2.0"`,请求体 `req_params.speaker == 传入的 voice`、`req_params.text == input`、`audio_params.format == "mp3"`、`user.uid` 为字符串。
  2. 资源 ID 来自模型名:`volcengine/seed-tts-1.0` → `seed-tts-1.0`;`volcengine/evil` → 400 `Unsupported TTS model: ...`(即使在 `tts_models` 里配置了它,也不能当资源 ID 用)。
  3. 非法音色(含空格/引号/过长)→ 400 `Invalid voice`,不调用上游。
  4. 上游 HTTP 403 带 `{"header":{"code":45000030,...}}` → 502 `Upstream authentication failed`(响应体不含上游文本,用 `secret-upstream-text` 断言);401 同理。
  5. 上游 500、`httpx.ConnectError`、响应 200 但没有任何音频块、中途出现 `code` 非 0 且非 20000000 的对象 → 502 `Upstream unavailable`。
  6. 未配置 key → 503;未登录 → 401;`input` 超过 4096 → 400。
  7. `azure/speech` 与 `openai/*` 的现有用例不受影响(现有 `tests/test_ai_audio.py` 原样通过)。
  8. `parse_stream` 单元测试:空输入、截断的 JSON(只有半个对象)→ 抛 `VolcengineError`;含 `sentence` 对象的流 → 忽略它们;base64 非法 → `VolcengineError`。
- [ ] **Step 2: 运行,确认失败。**
- [ ] **Step 3: 实现。**请求超时 `httpx.Timeout(120, connect=10)`;uid 用 `str(user.id)`;其余按「Interfaces」。流解析用 `json.JSONDecoder().raw_decode` 逐个取出对象,允许对象之间有空白或没有间隔。
- [ ] **Step 4: 运行全量测试**:`cd server && uv run pytest -q` → 0 failed。
- [ ] **Step 5: 文档**:`.env.example` 增加 `VOLCENGINE_TTS_KEY=`(留空,注释说明这是「豆包语音」控制台的 API Key,UUID 格式,不是方舟 Key)与 `VOLCENGINE_TTS_URL`(默认值不变),`TTS_MODELS` 的注释里加示例 `volcengine/seed-tts-2.0`;`README.md` 的「上游服务选择」补充一小节:需要在豆包语音控制台开通「语音合成大模型 2.0」,英文美式音色示例(Tim/Dacey/Stokie 的 ID),开通后可能有几分钟生效延迟。
- [ ] **Step 6: 提交** `feat(server): add volcengine (Doubao voice) TTS backend`。

### Task 9.2:配置下发与预设改写

**Files:**
- Modify: `server/app/routers/config_api.py`, `server/app/static_config/tts_providers_v2.json`(不要整体重生成,只增加 `volcengine` 键)
- Create/Modify tests: `server/tests/test_config_api.py`(追加用例,不改已有用例的含义)

**Interfaces:**
- `GET /api/config/tts_providers_v2` 返回的 `enjoyai.voices` 增加 `volcengine` 分组,元素为 `{"label": "Tim (Male)", "value": "en_male_tim_uranus_bigtts", "language": "en-US"}`、`Dacey (Female)`、`Stokie (Female)` 共 3 个;`enjoyai.models` 仍等于 `TTS_MODELS`(现有行为)。
- 预设改写(`gpt_presets`、`default_gpt_preset`、`default_tts_preset` 里 `engine == "enjoyai"` 的项):若其 `configuration.tts.model` 不在 `tts_model_list` 内,则改写为 `tts_model_list[0]`,并把 `configuration.tts.voice` 改为该模型的默认音色:`volcengine/*` → `en_female_dacey_uranus_bigtts`;`openai/*` → `alloy`;`azure/speech` → 保持原值。`tts_model_list` 为空则不改。若预设里还有 `tts.model` 字段之外的 TTS 相关字段(先读快照 JSON 的实际结构再处理,例如 `ttsModel`/`ttsVoice`),按同样规则处理并在报告里说明。

- [ ] **Step 1: 先读 `static_config/gpt_presets.json`、`default_gpt_preset.json`、`default_tts_preset.json` 的真实结构**,把实际的 TTS 字段路径写进测试。
- [ ] **Step 2: 写失败测试**:(a) `tts_models="volcengine/seed-tts-2.0"` 时,所有 enjoyai 预设的 TTS 模型/音色都被改写为 `volcengine/seed-tts-2.0` / `en_female_dacey_uranus_bigtts`;(b) `tts_models="openai/tts-1,azure/speech"`(测试默认)时预设**保持原样**(不改写);(c) `volcengine` 音色分组存在且 3 项字段齐全;(d) 非 enjoyai 引擎的预设不被改动。
- [ ] **Step 3: 实现**,保持 `apply_overrides` 的结构清晰(抽出小函数)。
- [ ] **Step 4: 全量测试** → 0 failed。
- [ ] **Step 5: 提交** `feat(server): serve volcengine voices and rewrite preset TTS defaults`。

### Task 9.3:客户端分发、音色重置、默认角色

**Files:**
- Modify: `enjoy/src/renderer/hooks/use-speech.tsx`、`enjoy/src/renderer/components/conversations/conversation-form/index.tsx`、`enjoy/src/constants/index.ts`,以及其他按同一模式处理 `azure` 音色的位置(先 `grep -rn "azure" enjoy/src/renderer enjoy/src/main enjoy/src/constants --include=*.ts --include=*.tsx`,逐个判断是否需要为 `volcengine` 增加对应处理,并在报告里列出每个命中的决定)

**Interfaces:**
- 行为:`tts()` 分发改为:`model.startsWith("azure")` → `azureTTS`;其余一律 `openaiTTS`(走服务端 `/api/ai`)。
- 行为:`conversation-form/index.tsx` 里按模型前缀重置音色的逻辑,为 `volcengine` 增加分支:当前音色不在 `ttsProviders.enjoyai.voices.volcengine`(按 `language` 与 `value` 匹配)中时,重置为该学习语言下的第一个音色。
- 行为:`AGENT_FIXTURE_AVA`、`AGENT_FIXTURE_ANDREW`(`enjoy/src/constants/index.ts`)的 `ttsModel`/`ttsVoice` 改为 `volcengine/seed-tts-2.0` 与 `en_female_dacey_uranus_bigtts`(Ava)/`en_male_tim_uranus_bigtts`(Andrew),`ttsEngine` 保持 `enjoyai`。

- [ ] **Step 1: 基线**:`cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep "error TS" | sort > <临时文件>`(应为 37 行)。
- [ ] **Step 2: 修改**(按上面的 Interfaces),`main` 进程 `enjoy/src/main/db/models/speech.ts` 只需核对:`engine === "enjoyai"` 时它用 OpenAI SDK 发送原样的 `model`(含 `volcengine/` 前缀)到 `${apiUrl}/api/ai`,确认无需修改并在报告里写明;若发现需要处理 `volcengine`(例如对模型名的假设),一并修复。
- [ ] **Step 3: 验证**:`tsc` 错误行排序后与基线完全一致;`grep -rn "volcengine" enjoy/src` 的命中点逐个说明。
- [ ] **Step 4: 提交** `feat(enjoy): route non-azure TTS models through the backend and use volcengine voices by default`。

### 验收门槛

- [ ] `cd server && uv run pytest -q` → 0 failed。
- [ ] 真实调用(由控制者执行):本地启动服务(环境变量传入豆包语音 Key,`TTS_MODELS` 含 `volcengine/seed-tts-2.0`),`POST /api/ai/audio/speech` 用 Tim/Dacey/Stokie 三个音色各合成一句英文,得到有效 MP3(以 `ID3` 开头、时长合理);`GET /api/config/tts_providers_v2` 与 `default_tts_preset` 返回改写后的内容;错误音色 → 400;没有 key → 503。
- [ ] 客户端 `tsc` 错误行与基线一致。
- [ ] 手动清单追加到 `docs/superpowers/plans/e2e-results.md`(未执行状态):默认角色 Ava 语音播放;新建对话选择 volcengine 音色并播放;切换模型后音色自动重置。

---

### Task 9.4:完整英文音色列表(来自官方音色列表)

用户只学英语,所以只提供**英文**音色,但要让用户在界面里自由选择官方列表里的全部英文音色。

**数据来源(已核对):** 官方「音色列表」页面 https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1 中「豆包语音合成模型 2.0」的中文主表与外语音色表(2026-10-03 读取)。排除了前缀为 `ICL_` 的声音复刻预置音色(按官方文档它们需要资源 ID `seed-icl-2.0`,`seed-tts-2.0` 调不了)。数据已筛成仅含美式英语(`en-US`)和英式英语(`en-GB`)共 **68** 个音色(64 + 4;男 41、女 27),保存在仓库里的 `server/app/static_config/volcengine_voices.json`,格式为紧凑数组 `[显示名, voice_type, 语言代码, 性别(M/F)]`。其中 Tim、Dacey、Stokie 已用真实接口验证可合成;多语种抽样验证表明不需要 `explicit_language` 参数。

**Files:**
- Create(已由控制者放入工作区,未提交): `server/app/static_config/volcengine_voices.json`
- Modify: `server/app/routers/config_api.py`(以及 9.2 里放置 3 个音色的位置)、`server/README.md`
- Modify tests: `server/tests/test_config_api.py`

**Interfaces:**
- `GET /api/config/tts_providers_v2` → `enjoyai.voices.volcengine` 由该 JSON 生成,元素 `{"label": "<显示名> (Male|Female)", "value": "<voice_type>", "language": "en-US|en-GB"}`,顺序与文件一致,**取代** 9.2 里手写的 3 个音色(Tim/Dacey/Stokie 仍在其中)。
- 默认音色(预设改写用)仍为 `en_female_dacey_uranus_bigtts`,测试断言它存在于列表中。

- [ ] **Step 1: 写失败测试**:(a) 列表长度 68,且全部 `language ∈ {en-US, en-GB}`;(b) `value` 全部唯一、都以 `en_` 开头、以 `_uranus_bigtts` 结尾,且不含 `ICL_`;(c) Tim/Dacey/Stokie 存在且 label 形如 `Tim (Male)`、`Dacey (Female)`;(d) 英式音色恰为 4 个(Charlotte、Alfred、Knightley、Russell);(e) 默认音色在列表中;(f) 数据文件不存在或格式损坏时,服务启动期/请求期给出明确错误(用一个临时损坏文件的测试说明行为)。
- [ ] **Step 2: 实现**:启动时一次性读取并校验该 JSON(行数组、每行 4 个字符串、性别 ∈ M/F),缓存;`apply_overrides` 使用它;不再包含手写音色。
- [ ] **Step 3: 全量测试** → 0 failed。
- [ ] **Step 4: README**:在火山 TTS 小节说明音色来源、仅收录英文、排除声音复刻音色的原因、如何刷新(重新读取官方页面并更新 JSON)。
- [ ] **Step 5: 提交** `feat(server): offer the full official English voice list for volcengine TTS`(把 `volcengine_voices.json` 一并提交)。
