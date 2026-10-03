# 讯飞 ISE 发音评测 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发音评测从「Azure token + 客户端 SDK 直连」改为「客户端上传音频 → 自建后端调用讯飞 ISE → 返回客户端评分界面已识别的 Azure 结构」。

**Architecture:** 后端新增 `app/xfyun.py`(签名、WebSocket 会话、XML 解析与结构转换)和接口 `POST /api/speech/assessments`;客户端 `use-pronunciation-assessments.tsx` 改为上传音频。Azure token 仍保留给默认语音转写使用。

**Tech Stack:** Python(FastAPI、`websockets` 异步客户端、标准库 `xml.etree`、`wave`)、pytest + pytest-asyncio;客户端 TypeScript。

**Spec:** 本文档的「设计」一节(设计由 2026-10-03 的探针实测和用户确认产生,延续 `docs/superpowers/specs/2026-10-02-self-hosted-backend-design.md`)。

## 设计(已由探针实测验证)

- 讯飞 ISE:`wss://ise-api.xfyun.cn/v2/open-ise`。签名:`date` 为 RFC1123 GMT;`origin = "host: ise-api.xfyun.cn\ndate: {date}\nGET /v2/open-ise HTTP/1.1"`;`signature = base64(hmac_sha256(APISecret, origin))`;`authorization = base64('api_key="{APIKey}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature}"')`;URL 查询参数 `authorization`、`date`、`host`。
- 首帧 `{"common":{"app_id":…},"business":{…},"data":{"status":0}}`,其中 business 为:
  `category="read_sentence"`, `rstcd="utf8"`, `sub="ise"`, `group="adult"`, `ent="en_vip"`(中文 `cn_vip`), `tte="utf-8"`, `cmd="ssb"`, `auf="audio/L16;rate=16000"`, `aue="raw"`, `text="﻿[content]\n" + 参考文本`,以及 **`ise_unite="1"`, `rst="entirety"`, `extra_ability="multi_dimension"`(这三项使所有分数为 0–100)**。
- 音频帧:每帧 1280 字节 PCM,`{"business":{"cmd":"auw","aus":A,"aue":"raw"},"data":{"status":S,"data":<base64>,"data_type":1,"encoding":"raw"}}`;`aus`:第一帧 1、中间 2、最后一帧 4;`status`:非最后帧 1、最后帧 2。
- 响应:`{"code":0,…,"data":{"status":N,"data":<base64 XML 或 null>}}`;`data.status==2` 时 `data.data` 是完整 XML;`code != 0` 为错误。音频要求 16 kHz、16 bit、单声道,最长 300 秒。
- 返回 XML(见 `server/tests/fixtures/ise_good.xml`、`ise_mismatch.xml`,为真实返回):`read_sentence > rec_paper > read_chapter(total/accuracy/fluency/integrity/standard_score, is_rejected, reject_type) > sentence > word(content,total_score,dp_message,beg_pos,end_pos) > syll(content,syll_score,beg_pos,end_pos) > phone(content,dp_message,beg_pos,end_pos,gwpp)`。`<word content="sil">`、无 `total_score` 的词是静音,要跳过。位置单位为 10 ms 帧。音素符号是 ARPAbet 风格(`hh eh l ow`)。`dp_message`:0 正确,16 遗漏,32 增读,64 重复,128 替换。
- **无参考文本 → 不评测**(用户已选方案 A):接口返回 400 `Reference text is required`。
- 转换成客户端结构(客户端 `camelcase-keys` 会把 snake_case 转 camelCase;服务端一律输出 snake_case):

```
{
  "pronunciation_score": <total_score>, "accuracy_score": ..., "fluency_score": ...,
  "completeness_score": <integrity_score>,
  "detail_result": {
    "confidence": 1.0, "display": <参考文本>, "itn": <同 display>, "lexical": <小写词用空格连接>, "masked_itn": <同 display>,
    "pronunciation_assessment": {"accuracy_score", "completeness_score", "fluency_score", "pron_score"},
    "rejected": <is_rejected>, "reject_type": <reject_type>,
    "words": [{
      "word": ..., "offset": <beg_pos*100000>, "duration": <(end_pos-beg_pos)*100000>,   # Azure 单位:100 ns;10 ms = 100000
      "pronunciation_assessment": {"accuracy_score": <word total_score>, "error_type": "None|Omission|Insertion|Mispronunciation"},
      "syllables": [{"syllable": <IPA 拼接>, "offset", "duration", "pronunciation_assessment": {"accuracy_score": <syll_score>}}],
      "phonemes": [{"phoneme": <IPA>, "offset", "duration", "pronunciation_assessment": {"accuracy_score": ...}}]
    }]
  }
}
```
  - 不输出 `prosody_score`(讯飞没有对应指标;客户端界面对缺省值有判断 `{prosodyScore && ...}`)。
  - `error_type`:`dp_message==16 → Omission`;`32` 或 `64` → `Insertion`;`128` → `Mispronunciation`;`0` 且词分数 < 60 → `Mispronunciation`;其余 `None`。
  - 音素准确度:`dp_message != 0 → 0`;否则 `min(词分数, 所在音节分数)`(讯飞不提供音素级分数,`gwpp` 经实测与词分数不一致,不使用)。
  - 分数保留两位小数;所有 `*_score` 取 `[0,100]`。
- ARPAbet → IPA 表(未知符号去掉重音标记 `'` 后再查,仍未知则原样输出):
  `aa ɑ, ae æ, ah ʌ, ao ɔ, aw aʊ, ax ə, ay aɪ, b b, ch tʃ, d d, dh ð, eh ɛ, er ɝ, ey eɪ, f f, g ɡ, hh h, ih ɪ, iy i, jh dʒ, k k, l l, m m, n n, ng ŋ, ow oʊ, oy ɔɪ, p p, r ɹ, s s, sh ʃ, t t, th θ, uh ʊ, uw u, v v, w w, y j, z z, zh ʒ`。所有输出的 IPA 符号都必须存在于 `server/app/static_config/ipa_mappings.json` 的键中(测试断言)。
- 错误映射:讯飞 `code` 10163/48195 → HTTP 400 `Invalid assessment parameters`;11200 → 503 `Speech evaluation is not authorized`;10114/60114 → 400 `Audio is too long`;其他非 0、超时、连接失败 → 502 `Upstream unavailable`;未配置密钥 → 503 `Pronunciation assessment is not configured`。
- 接口 `POST /api/speech/assessments`(multipart):`file`(16 kHz / 16 bit / 单声道 WAV)、`reference`、`language`(`en*` → `en_vip`,`zh*` → `cn_vip`,其他 400 `Unsupported language`)。需登录并经过 `limited_user` 限流;文件最大 25 MiB(413 `Audio file is too large`);时长 > 300 s → 400 `Audio is too long`;非合规 WAV → 400 `Audio must be a 16 kHz mono 16-bit WAV`。
- 密钥只放 `server/.env`(已被 git 忽略),设置项 `XFYUN_APP_ID`、`XFYUN_API_KEY`、`XFYUN_API_SECRET`、`XFYUN_WS_URL`(默认官方地址,便于测试替换)。**任何会提交的文件里都不得出现真实密钥。**

## 全局约束

- 沿用 `docs/superpowers/plans/2026-10-02-self-hosted-backend.md` 的全局约束(snake_case、错误体 `{"error": msg}`、单 worker、提交信息格式含 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`、Git Bash)。
- 测试与代码中不得出现真实密钥;夹具已确认不含密钥。
- 客户端改动只限本计划列出的文件,`tsc` 错误行与基线(37 条)保持一致。

---

## 阶段 A:后端

### Task 7.1:结果解析与结构转换(纯函数)

**Files:**
- Create: `server/app/xfyun_result.py`, `server/tests/test_xfyun_result.py`
- Fixtures(已存在):`server/tests/fixtures/ise_good.xml`, `server/tests/fixtures/ise_mismatch.xml`

**Interfaces:**
- Produces: `to_assessment(xml: str, reference: str) -> dict`(输出结构见「设计」;解析失败抛 `ValueError`);常量 `ARPABET_TO_IPA: dict[str, str]`、`def arpabet_to_ipa(symbol: str) -> str`。

- [ ] **Step 1: 写失败测试**

`server/tests/test_xfyun_result.py` 至少包含以下用例(用真实夹具):
  1. `test_good_scores`:`ise_good.xml` + 参考文本 `"Hello, nice to meet you. I would like a cup of coffee, please."` → `pronunciation_score ≈ 98.87`、`accuracy_score ≈ 99.54`、`fluency_score ≈ 97.14`、`completeness_score == 100.0`(`pytest.approx(abs=0.01)`),且结果里**没有** `prosody_score` 键。
  2. `test_words_shape`:13 个单词、顺序与内容正确(`hello` … `please`),不含 `sil`;第一个词 `hello`:`offset == 1*100000`、`duration == 53*100000`,`error_type == "None"`,`phonemes` 的 IPA 依次为 `["h","ɛ","l","oʊ"]`,`syllables` 有 2 个;每个音素有 `offset/duration/pronunciation_assessment.accuracy_score`(0–100)。
  3. `test_mismatch`:`ise_mismatch.xml` → `completeness_score < 10`、`pronunciation_score < 5`;`detail_result.rejected is True`;至少 8 个词的 `error_type == "Omission"`;这些词的所有音素 `accuracy_score == 0`。
  4. `test_low_score_word_is_mispronunciation`:用代码构造一个最小 XML(`dp_message="0"`、`total_score="40"`)→ `error_type == "Mispronunciation"`;`dp_message="128"` → `Mispronunciation`;`32` 与 `64` → `Insertion`。
  5. `test_phoneme_accuracy_is_min_of_word_and_syllable`:构造 word 90 / syll 70 → 音素 70;word 60 / syll 95 → 60。
  6. `test_all_ipa_symbols_exist_in_client_mapping`:对两个夹具的所有输出音素,断言 `phoneme in json.load(app/static_config/ipa_mappings.json)`。
  7. `test_arpabet_helpers`:`arpabet_to_ipa("ow") == "oʊ"`、`"'l"`(重音前缀)→ 去掉 `'` 后查表得 `"l"`、未知符号原样返回。
  8. `test_invalid_xml_raises_value_error`。
  9. `test_scores_clamped_and_rounded`:分数 `100.0049` → `100.0`;`-0.1` → `0.0`;保留两位。

- [ ] **Step 2: 运行,确认失败**(`ModuleNotFoundError: app.xfyun_result`)

Run: `cd server && uv run pytest tests/test_xfyun_result.py -q`

- [ ] **Step 3: 实现 `server/app/xfyun_result.py`**,严格按「设计」中的转换规则;只用标准库;函数小而清晰(解析、单词转换、音节转换、音素转换、IPA 映射、分数规整各自独立)。

- [ ] **Step 4: 运行,确认通过**;再跑全量 `uv run pytest -q` 无回归。

- [ ] **Step 5: 提交**

```bash
git add server/app/xfyun_result.py server/tests/test_xfyun_result.py server/tests/fixtures/
git commit -m "feat(server): convert iFlytek ISE results to the client's assessment shape" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7.2:讯飞 WebSocket 客户端(签名与会话)

**Files:**
- Modify: `server/pyproject.toml`(加依赖 `websockets>=13`,`uv lock` 后提交 `uv.lock`)、`server/app/config.py`、`server/.env.example`
- Create: `server/app/xfyun.py`, `server/tests/test_xfyun.py`

**Interfaces:**
- Consumes: `to_assessment`(Task 7.1,本任务不直接调用)
- Produces:
  - `Settings` 新字段:`xfyun_app_id: str = ""`、`xfyun_api_key: str = ""`、`xfyun_api_secret: str = ""`、`xfyun_ws_url: str = "wss://ise-api.xfyun.cn/v2/open-ise"`
  - `class XfyunError(Exception)`:属性 `code: int | None`、`message: str`
  - `class XfyunNotConfigured(Exception)`
  - `def signed_url(ws_url: str, api_key: str, api_secret: str, now: datetime | None = None) -> str`
  - `class XfyunIse(app_id, api_key, api_secret, ws_url)`:`configured: bool`;`async evaluate(pcm: bytes, text: str, ent: str, timeout: float = 60.0) -> str`(返回完整 XML 字符串)
  - `get_xfyun(request) -> XfyunIse`(FastAPI 依赖,懒创建并缓存在 `app.state.xfyun`,与 `get_azure` 同样的写法)

- [ ] **Step 1: 写失败测试** `server/tests/test_xfyun.py`:
  1. `test_signed_url_is_deterministic`:给定固定 `now`(例如 `datetime(2026,10,3,1,2,3,tzinfo=timezone.utc)`)与假密钥 `key`/`secret`,断言 URL 以 `wss://ise-api.xfyun.cn/v2/open-ise?` 开头;解析查询参数得 `date == "Sat, 03 Oct 2026 01:02:03 GMT"`、`host == "ise-api.xfyun.cn"`;`base64decode(authorization)` 等于 `api_key="key", algorithm="hmac-sha256", headers="host date request-line", signature="<期望签名>"`,其中期望签名在测试里**独立**用 `hmac`/`hashlib`/`base64` 重新计算。
  2. `test_signed_url_host_and_path_follow_ws_url`:传入 `ws://127.0.0.1:9999/custom` 时,签名原文使用 `host: 127.0.0.1:9999` 与 `GET /custom HTTP/1.1`(断言查询参数 `host`)。
  3. 用 `websockets.asyncio.server.serve` 在随机端口起一个**假讯飞服务**(pytest fixture,`ws://127.0.0.1:<port>/v2/open-ise`),按协议收帧、记录所有帧,最后回复若干 `{"code":0,...,"data":{"status":1,"data":null}}` 再回一帧 `status=2` 且 `data.data` 为 `ise_good.xml` 的 base64。`test_evaluate_happy_path`:`XfyunIse(...).evaluate(pcm=b"\x01\x02"*3000, text="Hello world", ent="en_vip")` 返回与夹具相同的 XML;断言假服务收到的**首帧**:`common.app_id`、`business` 中 `category=="read_sentence"`、`sub=="ise"`、`ent=="en_vip"`、`cmd=="ssb"`、`ise_unite=="1"`、`rst=="entirety"`、`extra_ability=="multi_dimension"`、`auf=="audio/L16;rate=16000"`、`text=="﻿[content]\nHello world"`、`data.status==0`;随后音频帧:每帧解码后 ≤1280 字节且拼接等于输入 PCM,第一帧 `aus==1`、最后一帧 `aus==4` 且 `data.status==2`、中间帧 `aus==2` 且 `data.status==1`。
  4. `test_error_code_raises`:假服务回复 `{"code":10163,"message":"bad param"}` → `XfyunError`,`code==10163`、`message` 含 `bad param`。
  5. `test_timeout_raises_xfyun_error`:假服务不回复,`timeout=0.3` → `XfyunError`(`code is None`)。
  6. `test_connection_refused_raises_xfyun_error`:指向未监听端口 → `XfyunError`。
  7. `test_not_configured`:空密钥 → `XfyunNotConfigured`(`configured is False`)。
  8. `test_settings_defaults`:新字段默认值。

- [ ] **Step 2: 运行,确认失败**

- [ ] **Step 3: 实现**。要点:使用 `websockets.asyncio.client.connect`;`now` 默认 `datetime.now(timezone.utc)`;日期用 `email.utils.format_datetime(now, usegmt=True)`;帧大小 1280 字节;发送完所有帧后循环 `recv`,直到 `data.status==2` 或 `code != 0`;整个会话包在 `asyncio.timeout(timeout)`;`OSError`、`websockets.WebSocketException`、`TimeoutError`、JSON 解析错误都转成 `XfyunError`;**日志与异常信息里不得包含密钥或带签名的 URL**。`.env.example` 增加四个变量(密钥留空,带注释说明去讯飞控制台获取)。

- [ ] **Step 4: 运行,确认通过**;全量 `uv run pytest -q` 无回归。

- [ ] **Step 5: 提交**

```bash
git add server/
git commit -m "feat(server): add iFlytek ISE websocket client with signed URL" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7.3:`POST /api/speech/assessments`

**Files:**
- Modify: `server/app/routers/speech.py`
- Create: `server/tests/test_speech_assessments.py`

**Interfaces:**
- Consumes: `get_xfyun`、`XfyunIse.evaluate`、`XfyunError`、`XfyunNotConfigured`(Task 7.2);`to_assessment`(Task 7.1);`limited_user`(已有,见 `server/app/deps.py`)
- Produces: HTTP 契约见「设计」。成功响应体即 `to_assessment` 的返回值。

- [ ] **Step 1: 写失败测试** `server/tests/test_speech_assessments.py`。用 `app.dependency_overrides[get_xfyun]` 注入一个假对象(记录调用参数、返回 `ise_good.xml` 的内容,可配置成抛 `XfyunError`/`XfyunNotConfigured`);WAV 用标准库 `wave` 在内存里生成(16 kHz/16 bit/单声道,0.5 秒静音)。用例:
  1. 未登录 → 401。
  2. 成功:返回 200;`pronunciation_score ≈ 98.87`;假对象收到的 `pcm` 长度等于 WAV 数据字节数(不含头)、`ent == "en_vip"`、`text` 为提交的 `reference`。
  3. `language="zh-CN"` → `ent == "cn_vip"`;`language="fr-FR"` → 400 `Unsupported language`。
  4. `reference` 为空或只含空白 → 400 `Reference text is required`(此时**不得**调用假对象)。
  5. 非 WAV / 采样率 44.1 kHz / 立体声 / 8 bit → 400 `Audio must be a 16 kHz mono 16-bit WAV`。
  6. 时长超过 300 秒(用 `monkeypatch` 把最大时长常量改小,或构造头部声明很长的 WAV)→ 400 `Audio is too long`。
  7. 超过上限(`monkeypatch` 把 `MAX_ASSESSMENT_BYTES` 改小)→ 413 `Audio file is too large`。
  8. 错误映射:`XfyunError(code=10163)` → 400;`11200` → 503;`60114` → 400;`code=None`/其他 → 502 `Upstream unavailable`;`XfyunNotConfigured` → 503 `Pronunciation assessment is not configured`。
  9. 非 multipart 请求 → 400(沿用 Whisper 路由的写法)。
  10. 限流:`settings_overrides` 里把 `ai_rate_limit_per_minute` 设为 2,第 3 次请求 → 429。(先读 `server/app/deps.py` 的 `limited_user` 确认配置项名称;若名称不同,以代码为准。)

- [ ] **Step 2: 运行,确认失败**

- [ ] **Step 3: 实现**:在 `speech.py` 增加路由(依赖 `Depends(limited_user)`、`Depends(get_xfyun)`、`Depends(get_settings)` 如需);读取 multipart(`UploadFile` + `Form`,或沿用项目里 Whisper 路由已有的写法,以一致为准);先校验 `Content-Length`/实际字节数 ≤ `MAX_ASSESSMENT_BYTES = 25 * 1024 * 1024`;WAV 校验用标准库 `wave`(`io.BytesIO`),`wave.Error`/`EOFError` → 400;`MAX_ASSESSMENT_SECONDS = 300`;把 `evaluate` 的 `XfyunError` 按「设计」映射;成功时 `to_assessment(xml, reference)`(`ValueError` → 502 `Upstream unavailable`)。

- [ ] **Step 4: 运行全量测试**:`cd server && uv run pytest -q` → 0 failed。

- [ ] **Step 5: 提交**

```bash
git add server/
git commit -m "feat(server): add pronunciation assessment endpoint backed by iFlytek ISE" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7.4:README 与冒烟脚本

**Files:**
- Modify: `server/README.md`, `server/scripts/smoke.py`

- [ ] **Step 1:** `server/README.md` 增加「发音评测(讯飞)」一节:配置三个环境变量与 `XFYUN_WS_URL`;接口说明;限制(必须有参考文本、WAV 16 kHz 单声道、≤5 分钟、无语调分数);提醒密钥重置方式。保持现有文风与 README 结构。
- [ ] **Step 2:** `smoke.py` 增加可选参数 `--wav PATH --reference TEXT [--language en-US]`:提供时多一项检查 `pronunciation assessment (xfyun)`:`POST /api/speech/assessments`,断言 200 且返回里有 `pronunciation_score`(打印总分与词数);503 → SKIP;不提供参数则不执行该检查。保持现有检查不变;`--help` 与 `ast.parse` 通过。
- [ ] **Step 3: 提交**

```bash
git add server/README.md server/scripts/smoke.py
git commit -m "docs(server): document iFlytek pronunciation assessment and extend smoke script" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 A(通过后才能开始阶段 B)

- [ ] `cd server && uv run pytest -q` → 0 failed。
- [ ] **真实调用**:`server/.env`(被 git 忽略)写入讯飞三项密钥后启动服务,用 `smoke.py --wav <good.wav> --reference "<原文>"` 与读错内容的 WAV 各跑一次:读对的总分 > 90;读错的总分 < 10 且有多个 `Omission`。
- [ ] `git grep -n "0cd2865b\|MzVjYjNm\|eabc23e9"` 无任何输出(仓库里没有真实密钥)。

---

## 阶段 B:客户端

### Task 7.5:评测改为上传音频

**Files:**
- Modify: `enjoy/src/api/client.ts`, `enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx`, `enjoy/src/i18n/{en,zh-CN,es}.json`

**Interfaces:**
- Consumes: 后端 `POST /api/speech/assessments`(阶段 A)
- Produces: `Client.assessPronunciation(params: {blob: Blob; reference: string; language: string}): Promise<{pronunciationScore: number; accuracyScore: number; completenessScore: number; fluencyScore: number; detailResult: any}>`

- [ ] **Step 1: 基线**:在编辑前保存 `cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep "error TS" | sort > <临时文件>`(应为 37 行)。
- [ ] **Step 2:** `client.ts` 新增 `assessPronunciation`:构造 `FormData`(`file`:`new File([blob], "audio.wav", {type: "audio/wav"})`、`reference`、`language`),`this.api.post("/api/speech/assessments", form, { timeout: 5 * 60 * 1000 })`;**请求**不经过 `decamelizeKeys`(FormData);响应由拦截器 camelCase 化。读懂 `Client` 构造里 axios 实例的默认 `Content-Type: application/json`:对 FormData 请求必须让浏览器自行设置 multipart 边界(如需显式处理,在该请求的 `headers` 里把 `Content-Type` 设为 `undefined`,并在报告里说明依据)。
- [ ] **Step 3:** 改写 `use-pronunciation-assessments.tsx` 的 `createAssessment`:
  - 删除 `generateSpeechToken` 调用与 `assess`/`continousAssess` 的 SDK 路径;**先** `grep -rn "continousAssess\|usePronunciationAssessments" enjoy/src` 确认没有其他调用方依赖这两个导出,有则保持其导出签名并说明,无则一并删除相关代码与 `microsoft-cognitiveservices-speech-sdk`、`THIRTY_SECONDS` 的无用导入。
  - 新流程:`reference` 为空(`!reference?.trim()`)时抛 `new Error(t("referenceTextRequired"))`;否则 `const result = await webApi.assessPronunciation({ blob, reference, language })`;随后保持原有 `EnjoyApp.pronunciationAssessments.create({...})` 的字段不变,`result`(即原来的 `resultJson`)使用 `result.detailResult` 并追加 `duration: recording?.duration`;去掉 `tokenId`;`prosodyScore`/`grammarScore`/`vocabularyScore`/`topicScore` 不传(undefined)。
  - 保留 `EnjoyApp.recordings.sync(recording.id)`、转码逻辑和返回值不变。
- [ ] **Step 4:** i18n 新增键 `referenceTextRequired`(en: `Reference text is required for pronunciation assessment.`;zh-CN: `发音评测需要参考文本。`;es 用英文),使用与之前任务相同的 node 脚本方式追加,`git diff --stat src/i18n` 每个文件只应新增约 1 行。
- [ ] **Step 5: 验证**:`tsc` 错误行排序后与基线**完全一致**(`diff` 无输出);不要启动图形界面,在报告里说明未做界面验证。
- [ ] **Step 6: 提交**

```bash
git add enjoy/
git commit -m "feat(enjoy): assess pronunciation through the self-hosted backend instead of the Azure SDK" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 B

- [ ] `tsc` 错误行与基线一致。
- [ ] `git grep -n "generateSpeechToken" enjoy/src` 的剩余命中只出现在 `use-transcribe.tsx`(默认语音转写仍用 Azure token)与 `client.ts` 的方法定义里。
- [ ] 手动清单(需要能运行客户端的机器,未执行则如实标注):录音后评测 → 评分环与单词/音素色块正常;读错内容 → 多个词标为遗漏;无参考文本的录音 → 提示需要参考文本。把这三项追加到 `docs/superpowers/plans/e2e-results.md`,状态「未执行」。

---

## 可并行开发

- 7.1(纯函数)与 7.2(WebSocket 客户端)互不依赖,可并行;7.3 依赖两者。
- 阶段 B 的 7.5 只依赖阶段 A 的**接口契约**(已在「设计」中固定),可与 7.3、7.4 并行编码,但验证需等阶段 A 通过。
