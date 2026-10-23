# 对象存储 / FSRS 词汇激活 / 影视配音 — 设计提案(待用户确认)

状态:**提案,未批准**。三个功能彼此独立,可分三条 lane;依赖关系见 §5。
代码现状摘自 2026-10-21 的只读摸底(文件:行号为当时所见,实现前须重新核对)。

---

## 1. 媒体与文件改存 S3 对象存储(MinIO)

### 1.1 目标
- 开发环境用 MinIO,生产用同一套代码接任意 S3 兼容存储(MinIO / 云厂商 OSS / R2)。
- 开发环境上传并解析好的视频,**不重新识别、不重新翻译**就能搬到生产(省 ASR 与 LLM 费用)。

### 1.2 现状(摸底结论)
- 全部文件落在 `data_dir`(默认 `/data`):`library/<uid>/<id>/media|poster|transcript.json`、`library/_catalog/<cid>/…`、
  `recordings/<uid>/<aid>.wav`、`room_audio/…`、头像、备份。
- 通过 `FileResponse` 提供下载(自带 Range)。库媒体走 30 分钟进程内票据,每次读取重验条目与用户。
- 精选库「添加」**不复制文件**:用户的 `LibraryItem.media_path` 直接指向 `_catalog/<cid>/…`(`catalog_store.py:289`)。
  所以 S3 键可以保持同一布局,无需复制对象。
- DB 里 `media_path` / `poster_path` 是 `String(200)` 相对路径(`models.py:1026,1103`)——天然可当 S3 key。
- 仓库里没有 boto3 / minio 依赖,也没有精选库导出/批量导入功能。

### 1.3 设计
**新增 `server/app/storage/`(底层层,只被 library/services/routers/admin 使用):**
- `BlobStore` 协议:`put_file(key, path)`、`put_bytes`、`get_bytes`、`download_to(key, path)`、`open_range(key, start, end)`、
  `stat(key)`、`delete(key)`、`delete_prefix(prefix)`、`list(prefix)`。
- 两个实现:`LocalStore`(现有行为,默认,零迁移成本)与 `S3Store`(boto3,同步调用包在 `asyncio.to_thread`)。
- 设置(env-only,密钥不进日志):`STORAGE_BACKEND=local|s3`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、
  `S3_REGION`、`S3_PATH_STYLE`(MinIO 需要 true)。
- 键 = 现有相对路径,**不改 DB 值**,不需要数据迁移。

**必须留在本地磁盘的部分(不迁):** ffmpeg/ffprobe/yt-dlp 的暂存目录(`library/_tmp/<id>`、`_catalog/_tmp/<cid>`、`chunks.json`、
WAV、`.part` 分片)。流水线最后一步的 `paths.replace(tmp → final)` 改为 `put_file` 再删本地。
需要对已有条目重新分句/重新识别时:先 `download_to` 临时目录,用完即删。

**播放(Range):** 默认由服务端**代理流式转发** `open_range`,保持现有同源、票据每次重验、无需 CORS 的语义,
`tests/test_library_range.py` 的约束继续有效。可选开关 `S3_PRESIGN_REDIRECT`(302 到短时效预签名 URL,省带宽)留作后续——
预签名 URL 含签名查询串,按安全规则不得进日志,且生产需要浏览器可达的 `S3_PUBLIC_ENDPOINT`,所以不作默认。

**分阶段迁移面:**
1. 库与精选库的 `media` / `poster` / `transcript.json`(体积大头)。
2. 录音(`recordings/`)、房间语音、头像。
3. 备份:`VACUUM INTO` 仍写本地,完成后上传并按保留数清理 S3。
`admin/storage.py`、`housekeeping.py`、`users_admin.py` 里的 `os.walk` / `rmtree` 改走 `list` / `delete_prefix`。
额度仍按 DB 字节数记账,不受影响。

**一次性迁移脚本** `python -m app.storage.migrate`:本地 → S3,幂等(跳过已存在且大小一致的键)、`--dry-run`、
不打印文件名(沿用隐私规则:日志里只有条目 id 与字节数)。

**docker:** `docker-compose.example.yml` 增加 `minio` profile(含自动建桶);开发 `server/.env.example` 增加 `S3_*` 占位。

### 1.4 「开发环境上传 → 生产」的真正解法:精选库打包(bundle)
只共享文件不够——还要 DB 行(句子、时间、译文)。设计:
- 管理端对一条已 ready 的精选条目「导出 bundle」:在桶里写 `bundles/<cid>/manifest.json`
  (元数据 + 句子 + 词级时间 + 译文 + 媒体键)。媒体对象本来就在 `library/_catalog/<cid>/…`。
- 迁移文件:`mc mirror dev/bucket/library/_catalog prod/bucket/library/_catalog`(或两边指同一桶)。
- 生产管理端「导入 bundle」:读 manifest,**直接建 catalog 行与句子,不走流水线**(无 ASR/翻译费用),校验媒体键存在后置为未发布。
- manifest 带 `schema_version`;不含任何用户数据。

### 1.5 测试
`conftest` 注入 `app.state.storage`,默认 LocalStore;新增 S3 契约测试跑 `moto` 内存 S3(不需要真 MinIO);
`catalog_helpers.make_catalog` 改经 `storage.put`;`test_architecture` 加 storage 层规则。

### 1.6 风险
- 约 159 个测试触及 `data_dir`,需要分批改(先把 helpers 改走 storage 接口)。
- 代理流式在高并发下占服务端带宽——先量,再决定是否开预签名。
- `os.replace` 的原子性假设在 S3 上不成立;靠「先 put 再写 DB、孤儿由清扫回收」保证一致。

---

## 2. 词汇激活检测 + 语境化复习(FSRS)

### 2.1 现状
- 调度是 **Leitner 固定间隔**,不是 SM-2/FSRS:`INTERVAL_DAYS = (1,2,4,7,15,30)`(`services/vocabulary.py:15`),
  `forgot / hard / good` 三档(`:55`)。进度模型 `VocabularyItem` 带 `box/due_at/reps/lapses`。
- 复习例句只取词典例句(`wordbook/quiz.py:36`、`cloze.py:50`),与用户自己的内容无关。
- 「用过没」只记今天学的词:`LinkWordUse`(`links/chat_words.py`);没有「学过的词里哪些真正用出口」的存量。
  实时通话的轮次没有发布 `MessageSent`(未验证,实现前需确认)。

### 2.2 关于「去 GitHub 找前沿算法直接复制」——调研结论(诚实版)
- **调度算法**:有现成成熟方案——[open-spaced-repetition/py-fsrs](https://github.com/open-spaced-repetition/py-fsrs)(FSRS,**MIT**,
  Python 3.10+,核心无重依赖;`Scheduler.review_card(card, rating)`、`get_card_retrievability`,支持短期步长与区间模糊;优化器是可选 extra)。
  Anki 官方已采用 FSRS。这一块**可以直接用**。
- **「激活检测」没有现成的端到端开源项目**:检索到的只是积木——CEFR 词表([Words CEFR Dataset](https://oosmetrics.com/repo/Maximax67/Words-CEFR-Dataset),MIT,
  本项目已有词级标注功能)、词形还原(项目已有 `wordbook/forms.py`)。检测逻辑要我们自己拼,下面给出设计。
- 许可:py-fsrs 是 MIT,允许复制或依赖;若选择 vendor 代码,须保留 LICENSE 与版权声明。

### 2.3 设计 A:调度换成 FSRS
- **推荐用 pip 依赖** `fsrs`(锁版本)而不是粘贴源码:一份代码、可升级、许可义务只是依赖声明。
  如果你坚持复制源码,放 `server/app/wordbook/fsrs/` 并附 LICENSE,代价是以后要手动同步。(待你选)
- `VocabularyItem` 新增 `stability / difficulty / fsrs_state / last_review`;保留 `box`,改为**由稳定度推导**
  (例如 stability ≥ 21 天 ≈ 掌握),这样 `plan.py`、`quiz.py` 里按 box 选题型的现有逻辑不动。
- 评分映射:`forgot→Again`、`hard→Hard`、`good→Good`;拼写全对且无提示且快 → `Easy`(阈值待调)。
- 旧数据迁移:`box` → 初始稳定度 `S = INTERVAL_DAYS[box]`,难度取默认,`lapses` 保留;一次 alembic + 回填,可回滚。
- 目标保持率默认 0.9(设置里可调 0.85–0.95)。`WordbookEvent` 补一列精确时间戳,为以后「按个人数据优化参数」留数据
  (优化器依赖较重,**本期不做**)。
- 先回放验证:用现有事件重放 Leitner 与 FSRS,对比「预测保持率 vs 实际答对率」再切换,默认灰度开关。

### 2.4 设计 B:词汇激活检测
目标:知道「学过的词里,哪些你真的在说/写里用出来了」。
- 新表 `word_usage(user_id, lemma, first_used_at, last_used_at, use_count, sources)`。
  **只存词形还原后的词与计数,绝不存消息文本**(沿用 links 层隐私规则,不进 URL/日志)。
- 来源:聊天(`MessageSent`)、实时通话 `transcript_final`(补发事件)、房间语音转写、跟读/配音(用户朗读原文不算「主动使用」,只记 `shadow`)。
- 匹配:倒排索引「词形 → lemma」(复用 `forms.py`)只针对用户**已学词集合**,代价小;不依赖 LLM。
- 状态:`沉睡`(已学、近 N 天从未主动用)/`萌芽`(用过 1 次)/`激活`(跨 ≥2 次会话用过)。
- 触达:(1)「沉睡词」列表页;(2)AI 对话开场把 2–3 个沉睡词注入角色提示词,让对话自然引出;
  (3)每日任务沿用现有 `chat-words` 插件的形态扩展;(4)主动使用**不**直接改 FSRS(v1),避免把「用过」误当「记得」。

### 2.5 设计 C:语境化复习(用用户自己的影视片段做例句)
- 流水线 ready 时对每个句子建索引表 `segment_lemma(segment_id, lemma)`(用户库与精选库都建)。
- 复习/完形题选例句:优先该词在**用户自己库里**的句子(6–16 词、非低置信),并带 `start_ms/end_ms`——
  题目可「播放这 4 秒原片再填空」;找不到才回落词典例句。
- 选句要稳定可复现(沿用现有 `(user,key,reps)` 种子)。

### 2.6 风险
FSRS 切换影响所有用户复习排期 → 必须灰度 + 回放验证;例句来自用户内容时注意不得带入日志;词形还原对短语动词/多词词条会漏检(接受,先覆盖单词)。

---

## 3. 跟读库「影视片段角色扮演配音」

### 3.1 目标体验(移动优先)
选一段片段(几句到 ~60 秒)→ 选扮演哪个角色 → **彩排**(带字幕看一遍)→ **录制**:视频自动播放,
对方角色的原声照常播,轮到你时**原声静音**、字幕按词高亮提示、倒计时 3-2-1,你开口 → 每句录完立刻后台打分 →
结束页显示总分、逐句得分,并可对比「原声 vs 你的」回放。

### 3.2 现状可复用
播放器与句级循环(`use-media-player.ts`)、录音与 16 kHz WAV 转换(`useRecorder`、`toAssessmentWav`)、
评分(`POST /api/speech/assessments`,讯飞 ISE,英文逐词/音素分,含逐词起止偏移 `beg_pos/end_pos`)、
`LibraryAttempt` 存成绩、`ScoreCard` 展示。
**缺口:** 句子没有说话人/角色;没有「连续播放中按时间窗录音」的流程;没有同步度评分;没有配音成品导出。
实时语音栈(ASR→LLM→TTS 级联)**不适合**本功能——这里不需要 LLM,硬套会引入延迟与费用。只借用其 PCM 播放器若后续做 AI 搭档。

### 3.3 设计
**角色标注(最关键的前置):**
- `library_segments` 增加可空 `speaker`(`A`/`B`/…);条目增加角色显示名。
- 标注方式:**手动为主 + LLM 建议**——用户在片段选择页看到句子列表,一键「这句是 A / B」;
  可点「智能建议」让 LLM 依据对白轮替给初稿(一次调用/片段,按现有 AI 额度计)。精选库由管理员标注一次,所有用户复用。
- 不做声纹分离(pyannote 需要 GPU 与 HF 授权,成本与收益不匹配)。

**录制流程(前端):**
- 视频元素按时间轴调度:对方句 `muted=false`;你的句 `muted=true`(同时避免回声)。
- 麦克风**仅在你的句子窗口内**录(句首前 300 ms 到句尾后 600 ms),窗口外不录——因此不会录进对方原声。
- 每句窗口结束 → 转 16 kHz WAV → 调现有评分接口(`source=library`,`save=true`)→ 并行回传,不阻塞播放。
- 麦克风/播放延迟补偿:同步度容忍窗口放宽(±400 ms),并在首次使用时提示戴耳机。

**打分:**
`总分 = 发音(ISE 总分) 60% + 流利(ISE) 20% + 同步 20%`(权重待真机调)。
同步 = 由 ISE 逐词偏移得到起词时刻与时长,对比原句 `start_ms/时长`:起始偏差与时长比越接近越高。
不做逐帧口型同步,不承诺「演技」评分。

**数据:** 新表 `library_dubs(id, user_id, item_id, seg_from, seg_to, role, total_score, created_at)`;
逐句成绩沿用 `LibraryAttempt` 增加 `dub_id`。录音存 `recordings/`(随 §1 进 S3)。

**成品导出(第二期):** 服务端 ffmpeg 把用户逐句录音按时间轴混入原视频、替换该角色音轨,产出 mp4 存 S3,可回看/分享。
依赖 §1 的对象存储与后台 worker,本期不做。

**成本与额度:** 每句一次 ISE;一个片段通常 3–8 句。沿用现有 assessment 额度与速率限制,片段上限(如 ≤ 12 句 / ≤ 90 s)。

### 3.4 风险
- iOS Safari 对「播放视频同时开麦克风」的音频会话切换要在真机验证(项目现有 `audio-focus.ts` 需要扩展);**未验证**。
- ISE 偏移精度是否够做同步度需要小样本实测;不够则回落为只看时长比。
- 角色标注的人工成本——所以精选库由管理员一次标好是主路径。

---

## 4. 建议的拆分与顺序
| lane | 内容 | 依赖 |
|---|---|---|
| L1 | §1 BlobStore + S3 + 迁移脚本(阶段 1:库/精选库) | 无 |
| L2 | §1.4 精选库 bundle 导出/导入 | L1 |
| L3 | §2.3 FSRS 切换(回放验证 + 灰度) | 无 |
| L4 | §2.4/2.5 激活检测 + 语境化复习 | L3 可并行,但选句依赖句子索引 |
| L5 | §3 角色标注 + 配音录制与评分 | 无硬依赖;成品导出依赖 L1 |
| L6 | §1 阶段 2/3(录音、房间、头像、备份入 S3) | L1 |

L1、L3、L5 可以并行开三个 worktree;同一批文件不并行写(L1 与 L5 都碰 library 路由,L5 只加新路由与表,冲突面小)。

## 5. 已定决议(2026-10-21,用户确认「按推荐」)
1. 播放:服务端代理流式转发(预签名 302 后续再议)。
2. FSRS:pip 依赖 `fsrs`(锁版本),不复制源码。
3. 角色标注:手动 + LLM 建议,不做声纹分离。
4. 存储后端:**只依赖 S3 API**,自建 MinIO 与云厂商(阿里云 OSS / 腾讯 COS / R2 / AWS S3 等 S3 兼容端点)靠配置切换,不改代码。
   前提与注意:`S3_PATH_STYLE`(MinIO 需 true,多数云厂商 false)、`S3_REGION`、签名版本以 boto3 默认为准;
   不使用厂商私有扩展;「切换」= 先迁移对象(见 §6)再改 env,而不是只改 env。
5. **全部迁移**(原阶段 1+2+3 一次规划,分批落地):影视库、精选库、录音、房间语音、头像、备份,**不允许丢数据**(§6)。

## 6. 迁移的不丢数据保证(适用于 本地→S3、MinIO→云厂商 两种方向)
- **只复制、不移动**:源数据在整个迁移与观察期内保持原样,不自动删除;删源由用户单独下指令。
- **逐对象校验**:上传后 `stat` 比对大小,并比对 sha256(源端流式计算,上传时写入对象元数据 `x-amz-meta-sha256`);不一致即报错,不算完成。
- **清单驱动 + 可续跑**:迁移前生成清单(键、大小、sha256),落到本地文件;幂等、断点续传、`--dry-run`、`--verify-only`(只核对不写入)。
- **读回退**:切换后的观察期内,`S3Store.get` 未命中时回退读旧后端(双读),并计数告警;确认计数为 0 后才关闭回退。
- **DB 一致性**:迁移前后用 DB 里所有 `media_path/poster_path/录音路径` 与存储清单做对账,报告「库里有、存储没有」和「存储有、库里没有」(孤儿只报告不删)。
- **备份先行**:迁移开始前强制一次 DB 备份(沿用 `admin/backups`);回滚 = 把 `STORAGE_BACKEND` 改回旧值,因为源数据未动。
- 日志只记数量、字节数、耗时、错误码,不出现文件名、用户 id 与对象键(沿用隐私规则)。

## 7. 本次一并提出的前端问题
深色模式无法开启、玻璃透明度上限可继续放宽——见本文档之外的会话记录;复现与结论确认后再写计划。
