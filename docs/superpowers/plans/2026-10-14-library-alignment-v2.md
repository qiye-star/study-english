# 跟读库句边界 v2:词级时间对齐(服务端 + 网页)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户的要求是「重新设计算法,提高精准度」。本计划把跟读库自动识别条目的句边界从「识别句(utterance)的起止 + 句内按字符比例摊」改成「**每个词的真实起止**」:句子从第一个词的起点开始、到最后一个词的终点结束(再加几十毫秒、只占相邻间隔一部分的余量),长停顿处断句,短句不跨音乐 / 长停顿合并,硬切的块边界前后各多听 1 s 并按时间去重;用「按这条素材自己的语速分布」的检查代替固定的字符速度阈值,并给每一句标出可疑原因;识别服务的原始输出(含每个词)随条目保存,算法以后再改进时**一键「重新分句」不再花识别钱**;配一套无参照的一致性报告 + 手工金标准打分工具来量化精度。词级时间是否可用由**收费的 Task 0 探针**裁决,开工前必须得到用户的明确同意。

**Architecture:** `app/speech/timed.py` 增加 `Word`,`Utterance.words`;`asr_stream.parse_words` 解析 `utterances[].words`;`asr.make_timed_transcriber(final_empty=True)` 让跟读库把「识别为空」当成「没有人声」而不再付费回落。`app/library/asr_chunks.py`:硬切处 2 s 重叠(`plan_chunks(..., overlap_ms)`,只在有带时间的转写器时)、`chunks.json` 版本 3(带词)、`save_transcript` / `load_transcript`。三个新纯模块:`timeline.py`(识别句文字的词元按字母对齐到词,对不上的在已知时间之间摊,不可信块回落 v1 估算,重叠接缝去重)、`wordseg.py`(词元 → 句子:`split_all` 定文字,停顿断句、超长断在最大间隔、短句只在小间隔内合并、带上限的余量)、`sentences.py`(总入口:有词走词路径,否则 v1 原样;流水线与「重新分句」共用)。`quality.py` 追加 v2 检查(稳健 z 分数、每句标记、条目按比例判 `low_confidence`)。迁移 `0020`:`library_segments.flags`、`library_items.rebuildable`。流水线把识别结果写到条目目录的 `transcript.json`;新端点 `POST /api/library/items/{id}/rebuild`。网页:卡片 ⋯ 菜单「重新分句(不用额度)」+ 确认、句子列表里可疑句的小圆点、播放缓冲不越过相邻句之间的空隙。两个手动脚本:`scripts/asr_words_probe.py`(Task 0)、`scripts/library_alignment_eval.py`(评估)。

**Tech Stack:** FastAPI + SQLAlchemy + alembic + pytest(服务端,只用标准库:`difflib`、`bisect`、`math`、`json`);React 18 + vitest(网页)。**不新增依赖**(VAD 是 Task 14 的关口问题,默认不引入);不改 `enjoy/`、`app/speech/sentence_split.py`、`app/library/segment.py`、`tests/fixtures/sentence_cases.json`。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md` §6.3–§6.4(E5、E6)与 `docs/superpowers/specs/2026-10-13-review-after-answer-and-library-alignment-design.md` §4(D5–D9)。前置计划 `docs/superpowers/plans/2026-10-13-library-alignment.md`(v1:真实识别句时间、`low_confidence`、重新识别,已合并)。本计划**偏离** spec 的地方见末尾「与 spec 的偏离」,开工前请用户过目。

## Global Constraints

- **隐私(`server/app/library/CLAUDE.md` 的 Pitfalls 全部适用):** 日志、错误、审计、计量里永远没有标题、文件名、URL、字幕 / 转写文字(含 `utterances[].text`、`words[].text`)、ffmpeg 输出、票据;只记条目 id、阶段、`error_kind`、块数、句数、毫秒数、算法名常量(`words` / `v1`)。新路由 `POST /items/{item_id}/rebuild` 进 `tests/test_library_privacy.py` 的 `ROUTES`。`transcript.json` 含转写文字:只在条目目录里,删条目 / 删用户 / 换字幕时删除,不进备份,不进日志,不复制到别处。两个脚本只打印字段名、条数、毫秒数(测试守着)。
- **分层:** `tests/test_architecture.py` 一字不改。新模块都在 `app/library/`(只导入 core / models / providers / speech / services 与本包);`app/speech/timed.py` 仍只依赖标准库。
- **不改:** `enjoy/`、`app/speech/sentence_split.py`、`app/library/segment.py`、`tests/fixtures/sentence_cases.json`(字幕路径与 v1 回落仍走 `segment.py`;句子文字仍由 `split_all` 决定)。
- **花钱与外部服务:** 只有 Task 0 调用真实识别服务,**没有用户在对话里的明确同意不得运行**;测试一律用假服务。新依赖只在 Task 14 用户同意后才可能引入(默认不引入)。
- **迁移:** `alembic/versions/0020_library_word_alignment.py`(head 现为 `0019`),两个 `ADD COLUMN`,降级用 batch;`tests/test_migrations.py` 里 5 处 `get_heads() == ["0019"]` 与 `tests/test_library_models.py` 的 head 断言同一提交改成 `0020`。
- **工作树是 CRLF:** 改现有文件用 Edit 工具(多行 `old_string` 匹配失败时改成逐行匹配,或用保留 CRLF 的小脚本替换,效果相同);新文件用 Write(LF,git 会规范化)。JSON 夹具由测试写出。
- **提交:** conventional,一任务一提交(Task 0 两个提交:脚本、结果),每个提交后该任务列出的测试全绿,信息以空一行后的 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **只在用户要求时:** 重建 / 重启容器、跑全量测试、跑 E2E、构建。每个任务只跑它列出的测试(服务端加 `tests/test_architecture.py`;网页加 `yarn web:typecheck`)。
- **验证口径(如实):** 写计划时**没有调用任何真实识别服务**。服务端 Task 1–10 的全部代码与测试在一份 `server/` 的临时副本里真实运行过:新增与改动的测试连同 `tests/test_library_*.py`、`test_admin_library.py`、`test_architecture.py`、`test_migrations.py`、`tests/test_asr_*.py` 共 982 通过、1 跳过(`test_sentence_split.py::test_the_abbreviation_table_matches_the_web_table` 在临时副本里因找不到 `web/` 失败,与本计划无关)。网页 Task 11–12 的代码与测试在一份 `web/`(含 `node_modules` 副本)里真实运行过:`src/features/library` 全部 61 个文件 + `architecture.test.ts` 436 通过 1 跳过,`tsc --noEmit` 除了副本里缺 `e2e/` 引起的 2 条外无错误。执行者第一次运行时仍以真实结果为准修正。**凡需要真实识别服务、真实素材或真机的结论一律「未验证」**:词级时间的字段与基准、对齐率、跨次识别抖动、边界误差、听感、阈值误报率。
- **提示:** 文中「核对」= 写计划时已读真实代码得出结论(见裁定表),执行者不必再猜。

## 设计

### 1. v1 根本上错在哪里(读代码 + 用户实测)

v1(`asr_chunks.fragments` → `segment.build` + `snapper`)能把「开头 27 s 音乐」修好(用户实测第一句起点 27.37 s),但它的**时间单位选错了**,后面的每一步都在弥补这个错误:

1. **时间粒度是识别句,不是词。** 一个识别句可以很长(Task 0 素材 A 有一条 248 个字符、13.5 s),里面常有好几句话和停顿。v1 在识别句里按**字符比例线性插值**定句边界(`Aligned.time_at`)——只要说话速度不均匀、句中有停顿,边界就偏,偏差随识别句长度增大,可达秒级。识别服务其实已经给了每个词的起止(Task 0:`words[{text,start_time,end_time}]`),v1 在 `parse_utterances` 里把它丢了。
2. **句子的起止 = 识别句的起止,包含停顿与音乐。** 识别句的边界由识别服务自己的断句决定,可能把句前句后的停顿、背景音乐算进去;v1 照单全收。
3. **把句子挪向「静音中点」。** `snapper` 把同一片段内的句边界挪到 ±0.8 s 内最近的 `silencedetect` 静音中点。在有背景音乐时静音表是空的(用户实测 -35 dB 下零静音),这一步要么什么都不做,要么把一个本来由时间证据决定的边界挪到离人声更远的地方。
4. **短句合并不看间隔。** `finish._merge_short` 把 < 1 s 或 < 3 词的句子并进相邻句,合并后的起止取两者的最小 / 最大值,**中间隔了多少秒音乐都算进去**。「Okay.」+ 10 s 音乐 + 「Let's go.」就成了一句 19 个字符、十几秒的句子——与用户报告的 idx 51(382.3–395.8 s,19 个字符)形状一致(**假设,未确认**,见第 8 条)。
5. **不可信的块整块回落到字符平摊。** 一块的识别句与文字对不上(相似度 < 0.9)或时间越界,整块 40 s 都回到 v1 的估算;同一条素材里真实时间与估算混在一起;用户报告的低速句子(4–5 字符 / 秒)可能出自这里、第 2 条或第 4 条(**未确认**)。
6. **块边界会切开词,拼接时不去重。** 没有静音时在 40 s 处硬切;切点落在词中间时,两块各听到半个词(或识别成别的词、或丢掉)。v1 只是把两块文字用一个空格接起来,识别句终点还被钳到块长(`min(length, u.end_ms)`)。
7. **合理性检查用的是固定阈值、且一句就判整条。** 6–25 字符 / 秒是猜的;用户这位说话快(中位 20、p90 25.1、最快 30.3),12 句「超速」都是真的快,却让整条素材被标 `low_confidence`;真正的错误(句子被拉长)和「这句里有停顿」也分不开(速度是按含停顿的句长算的)。
8. **识别结果用完就扔。** `chunks.json` 在 `_tmp`,条目 ready 时删除。所以(a)用户那条素材的 5 个低速句子到底是第 2、4、5 条中哪一个造成的,**现在无法确认**,只能再花钱重新识别;(b)算法的任何改进都要重新付费识别才能生效。
9. **没有任何度量。** 阈值、容差都没有和人耳比过,改了也不知道是变好还是变坏。

### 2. v2 的核心算法(`timeline` → `wordseg` → `quality`)

**一句话:** 句子的文字仍然由共享切句器 `split_all` 决定,但句子的时间完全来自识别服务给的词级时间——句首 = 第一个词的起点,句尾 = 最后一个词的终点,中间的停顿只用来断句与判断,不再被平摊。

1. **词元与对齐(R-V2/R-V3):** 识别句文字按空白切成词元(带标点,`split_all` 需要它)。词元与 `words` 先按「规范化后的整词」顺序匹配(`SequenceMatcher` 比较两个词表),中间没对上的一段若字母连起来相同(`well-known` ↔ `well` `known`)再按字母位置对应;其余(`$25` ↔ `twenty five` 这类数字规范化、符号)标 `interp`,在左右已知时间之间按字符数摊。一个识别句里不到一半的词元对得上 → 不相信这句的词,整句摊在识别句起止之间(= v1 的真实时间路径)。没有可信识别句的块 → v1 估算(`est`)。
2. **接缝(R-V5/R-V6):** 只在硬切处(没有静音可切)让两块各多听 1 s。重叠窗口里,在「离两边所有词中点都最远」的时刻 T 切开,左块留中点 < T 的词,右块留中点 >= T 的词;两边窗口里的词对不上(相似度 < 0.6)→ 附近的词标 `seam`。有一边没有词级时间(回落到了只给文字的识别)→ 按文字找「左块末尾 = 右块开头」的重复词(至少 2 个)去掉。
3. **断句(R-V10):** `split_all` 给出句子文字;句中两个有时间的词之间停顿 >= 2 s,或 >= 1 s 且前一个词以 `, ; : -` 结尾,并且两边各至少 2 个词 → 断开;超长(> 14 s 或 > 40 词)断在最大的间隔(>= 400 ms 优先,再看标点,再靠近中点);短句(< 1 s 或 < 3 词)只并到间隔更小的一侧,且这个间隔 <= 700 ms。
4. **余量(R-V11):** 服务端每句前加 40 ms、后加 80 ms(识别服务的词终点常落在尾音释放之前),每侧最多占与相邻词间隔的 40%,所以句与句不重叠、不伸进别人的词;每句至少 200 ms(网页微调的最小长度)但不越过下一个词;最后一句不超过素材长度。网页原来固定的「提前 150 ms / 延后 250 ms」改为:与相邻句之间有空隙时最多用到这段空隙,首尾相接时(字幕常见)保持原样。
5. **判断(R-V13/R-V14):** 每句可能有 5 种标记——`rate`(去掉 > 300 ms 停顿后的发音速度,对这条素材所有句子的中位数取对数后算稳健 z 分数,|z| > 3.5;少于 8 句时只抓 < 5 或 > 35 字符 / 秒的荒唐值)、`pause`(句内还有 > 1.5 s 的停顿)、`timing`(>= 30% 的词时间不可信:没对上的、长度为 0 的、每字母毫秒数在本条素材里是稳健离群值的)、`estimated`(有词完全没有识别时间)、`seam`(接缝两边识别不一致)。**条目**的 `low_confidence` = 被标记的句子 >= 15%。

### 3. 块边界与额外的识别费用(量化)

- 选择:**只在硬切处重叠 2 s**(左块多听切点后 1 s,右块从切点前 1 s 开始),静音处切开的块不重叠;只在带时间的转写器打开时生效(只有文字的转写没法按时间去重)。常量 `limits.ASR_HARD_CUT_OVERLAP_MS = 2_000`,改成 0 即关闭。
- 代价(测试 `test_fifteen_minutes_without_any_silence_costs_about_five_percent_more_with_overlap` 钉住):15 分钟、**全程没有一个静音**(最坏情况,用户那条素材的开头就是这样)时,按块计的识别秒数(每块向上取整)从 900 s 变成 944 s(**+44 s,+4.9%**);重叠 3 s 则是 981 s(+9%,其中约 12 s 是每块 41.5 s 向上取整的浪费)。所有切点都在静音里时额外费用为 0。
- 替代方案与取舍:(a)先粗识别一遍、只在词间隙切块:精确,但识别费用翻倍(+100%),否决;(b)顺序识别、下一块从上一块最后一个可靠词间隙开始:没有接缝问题、费用与重叠相近,但失去并发 2(15 分钟素材的处理时间约翻倍),否决;(c)不重叠只靠文字去重:切开的词两边都不完整,文字去重找不到,否决。
- 风险:重叠窗口里连续快速说话、两边识别的词都对不上时,`seam` 标记会出现在附近 1–2 句上(学习者看得到,可以微调)。

### 4. 要不要 VAD / 能量检测代替 silencedetect

**结论:不需要,默认不引入(Task 14 关口,停下来问用户)。** 有了词级时间,**识别服务本身就是人声检测器**:句子的起止、句前句后的音乐都由词时间决定,静音表只剩两个用处——选块的切点(硬切已由重叠解决)和没有词级时间时的 v1 估算(这部分句子会被标 `estimated`,可以重新识别)。引入 VAD 只能改善这两处,而且代价不小:

| 选项 | 体积(**近似,来自包索引的记忆,决定前实测**) | 对背景音乐 | 备注 |
|---|---|---|---|
| silero-vad(onnx)+ `onnxruntime` | 模型约 2 MB;`onnxruntime` 的 Linux wheel 十几 MB、安装后几十 MB | 能区分人声与音乐 | 网页已经带了它的浏览器版(`@ricky0123/vad-web`),服务端要另装 Python 运行时 |
| `webrtcvad-wheels` | 约 0.1 MB | 弱,持续音乐常被判成语音 | 对本问题几乎无帮助 |
| ffmpeg 自带的能量统计(`astats` / `ebur128`,相对能量最低点切块) | 0(镜像里已有 ffmpeg) | 只能找「相对最安静」的点,不能区分人声 | 若以后要改切点,这是第一候选,不需要新依赖 |
| pyannote / torch 系 | 数百 MB 起 | 好 | 镜像与 CPU 代价不可接受(spec §5 已排除本地强制对齐) |

### 5. 每个词的「可信度」

- `definite` 是识别句级的「已定稿」标志,不是置信度(Task 0:最终帧里全是 true);`parse_utterances` 仍丢掉 `definite == false` 的句子。
- `additions`:Task 0 只记录了字段名,内容未知;本计划**不使用**(R-V18),Task 0 v2 探针再记一次它的键名。
- 识别服务没有给每个词的置信度,所以词级可信度由时间证据推出:对不上文字(`interp`)、长度为 0、每字母毫秒数是本条素材的稳健离群值 → 「可疑词」;一句里可疑词 >= 30% → `timing`。
- 「按说话人自适应」:速度与词长都和**这条素材自己的中位数**比(对数尺度、MAD 下限 0.05),所以快语速、慢语速的素材都不会整体被误报;只有偏离自身分布很远的句子被标出。

### 6. 句中的长停顿

断(见 §2 第 3 条),但守住两条:断开后每边至少 2 个词(不留下孤零零的一个词);只在 >= 2 s 时无条件断,1–2 s 只在逗号 / 分号 / 冒号 / 破折号后断(保留「句意」)。没断开的长停顿(例如只剩一个词的那一侧)由 `pause` 标记告诉学习者。

### 7. 首尾余量与循环播放

服务端 40 / 80 ms + 网页「不越过空隙」的缓冲:学习者听到的是「第一个词前最多一小段空隙」到「最后一个词后最多一小段空隙」,从不包含相邻句的词。首尾相接的句子(字幕、v1 的旧条目)保持原来的 150 / 250 ms,行为不变。余量是常量(`wordseg.LEAD_PAD_MS` / `TAIL_PAD_MS`),金标准测出系统性偏差后改常量 + 「重新分句」即可,不花钱。

### 8. 没有词级时间时

`sentences.build` 的规则:至少一个可信块带词 → 词路径(没有词的块在词路径里按 v1 的方式摊开并标 `estimated`);一个词都没有(只给文字的识别、旧的 v2 状态文件)→ **v1 原样**(`segment.build` + 静音吸附 + v1 合理性检查),重叠的块先按文字去重。字幕条目完全不受影响。

### 9. 保留原始识别结果与「重新分句」

- **存什么、存哪里:** 条目 ready 时把最终的块列表(每块的文字、识别句、每个词 `[text, start_ms, end_ms]`)和静音表写成 `library/<uid>/<item>/transcript.json`(紧凑 JSON,`TRANSCRIPT_VERSION = 1`)。写在提交 ready 之前(`transcript.json.new`),提交之后原子改名;提交时发现条目已被取消则删掉 `.new`。
- **大小:** 测试夹具实测约 **38 字节 / 词**(含识别句与块的文字);用户那条 15 分钟、语速约 20 字符 / 秒的素材约 3,300–3,600 个词 → **约 130–150 KB**,不到 15 分钟 720p 视频的 0.2%;不计入 `library_bytes`(R-V8)。
- **隐私:** 与 `library_segments.text` 同等敏感;永不进日志;删条目(`paths.remove_item_files`)、删用户(`remove_user_files`)时随目录删除;换字幕时删除并把 `rebuildable` 置 false;不在备份里(`admin/backups.py` 只备份数据库)。
- **重新分句:** `POST /api/library/items/{id}/rebuild`:`ready` + `sub_source == "asr"` + `rebuildable` + 文件可读 → 用**当前**算法重建句子(在线程里算,`upload_lock` 里写),不排队、不扣额度、不调用识别服务;文字没变的句子保留译文与分析;手动修改被替换(确认框说明)。旧条目(v2 之前识别的)没有文件 → 409 `Item cannot be rebuilt`,只能「重新识别」。
- **重新识别:** 端点不变;流水线跑 v2,结束时用新的 `transcript.json` 替换旧的;失败 / 取消时旧文件不动。

### 10. 评估

- **无参照的一致性报告**(`scripts/library_alignment_eval.py report`):对同一份 `transcript.json` 同时跑当前算法与 v1,打印:倒置 / 重叠 / 不单调的句子数、句首到第一个词与最后一个词到句尾的距离(中位 / p95 / 最大)、切在词中间的句边界数、句内仍有 > 1.5 s 停顿的句子数、句长分布、各标记计数、被标记的比例、空块数、重叠接缝数与 `seam` 词元数、各类词元(`word` / `interp` / `est`)数量、> 5 s 没有任何词的区间(只列时间,给人工抽查「是音乐还是漏识别」)。
- **金标准**(`sample` + `score`):在条目里均匀抽 N 句(默认 30,固定种子),输出只含时间的模板;用户用音频编辑器打开**条目自己的媒体文件**(与句子同一时间基准),写下每句第一个词真正开始、最后一个词真正结束的毫秒数;`score` 按「与金标准重叠最多的句子」配对,输出起点 / 终点绝对误差的中位数与 p95、带符号的偏差中位数、「吃头吃尾」率(起点晚于真实起点 > 50 ms 或终点早于真实终点 > 80 ms),并与 v1 在同一份识别结果上的成绩对比。
- **验收目标(未验证,金标准存在之前只是目标):** 起点误差中位数 <= 120 ms、p95 <= 400 ms;终点误差中位数 <= 150 ms、p95 <= 500 ms;吃头吃尾率 <= 5%。

### 11. 能做到多准、做不到什么

- **上限 = 识别服务的词时间精度。** 端到端识别模型给出的词边界通常有几十到一百多毫秒的系统性偏差与抖动;火山的实际精度**未知**。Task 0 用「同一段音频识别两次(整段 vs 半段)」测跨次抖动,这是噪声的下限估计,不是误差本身。
- **v2 按构造消除的错误:** 句首句尾带进音乐 / 停顿(由词决定)、识别句内部的字符插值(由词决定)、跨长间隔的短句合并(<= 700 ms 才合)、块边界切开的词(重叠 + 去重)、快语速被整体误报(自适应检查)。
- **仍然存在:** 识别服务漏掉的词(句子少了,`word_free_spans` 能提示)、识别服务把词时间给错(不对齐的才会被发现)、数字规范化等对不上的词(`interp`,有标记)、音乐盖住人声时识别本身不准。要超过识别服务的精度只能做本地强制对齐(wav2vec2 / MFA 类,需要 torch 级依赖),spec §5 已排除。
- **对用户那条素材的预期(未验证):** 12 句「超速」不再触发标记;5 句低速句子若来自合并 / 识别句内停顿,会被断开或收紧到词;若来自识别漏词,则在报告里表现为 `word_free_spans`。

### 12. 取舍一览

| 取舍 | 得到 | 付出 |
|---|---|---|
| 硬切处重叠 2 s | 不再切开词 | 最坏 +4.9% 识别秒数 |
| 保留 `transcript.json` | 算法改进免费生效、能诊断 | 每条约 150 KB 磁盘;多一份含转写文字的文件(随条目删除) |
| 长停顿断句 | 循环里不再有几秒空白 | 句子更多,少数句子从逗号后开始 |
| 短句不跨 > 700 ms 合并 | 「Okay.」不再被拉成十几秒 | 列表里多一些一两个词的短句 |
| 自适应检查 | 快 / 慢语速不被误报 | 少于 8 句的素材只能用宽松的绝对阈值 |
| 识别为空即没有人声 | 省掉回落的钱、不让聊天模型在音乐上编句子 | 火山误判为空时失去第二次机会(用户实测 3 块回落也为空) |
| 不引入 VAD | 镜像不变、无新依赖 | 没有词级时间的块仍是 v1 估算(有 `estimated` 标记) |

## 执行顺序与关口

| 顺序 | 任务 | 依赖 |
|---|---|---|
| 1 | **T0** 词级时间探针脚本 + 测试(不花钱的部分) | 无 |
| 关口 G0 | **停,问用户是否花钱运行探针**(两段约 60 s 的素材,每段 3 次请求,合计约 4 分钟识别);同意后运行并记录结果 | T0 脚本 |
| 关口 G1 | 读 T0 结果决定是否走词路径(判据见 Task 0 Step 9);不满足 → **停,问用户** | G0 |
| 2 | **T1** 语音层:`Word`、解析 `words`、`final_empty` | 无(无害,可与 T0 并行) |
| 3–6 | **T2** 块 v3(重叠、状态文件带词、保留识别结果)→ **T3** `timeline` → **T4** `wordseg` → **T5** v2 检查 + `sentences` 总入口 | G1 通过、T1 |
| 7 | **T6** 迁移 `0020` + 模型 + `store`(标记、`rebuildable`、保留译文) | T5 |
| 8 | **T7** 流水线接线 + worker(`final_empty`)+ 保留 `transcript.json` | T6 |
| 9 | **T8** 「重新分句」端点、换字幕删识别结果、手动改时间清标记、隐私清单 | T7 |
| 10 | **T9** 契约夹具重录(服务端) | T8 |
| 11 | **T10** 评估脚本(报告、金标准模板、打分) | T5、T7 |
| 12–13 | **T11** 网页类型 / 契约 / `patchSegment` / `mergeSaved` / 文案 → **T12** 网页界面(菜单、确认、可疑句圆点、不越过空隙的缓冲) | T9 |
| 14 | **T13** 文档、`CLAUDE.md`、结果文档的「未验证」清单 | 全部 |
| 关口 | **T14** VAD:只问不做(默认不引入) | 用户想要时 |

T6 改了 `item_out` / `segment_out` 的键,从 T6 到 T9 之间 `tests/test_library_contract.py` 会失败(T9 重录),T9 到 T11 之间网页的 `library-contract.test.ts` 会失败(T11 修):这两个文件只在 T9 / T11 跑。

## 对「核对」项的裁定(读真实代码得出)

| 核对项 | 结论 |
|---|---|
| v1 怎么拼接块边界的文字 | `asr_chunks.fragments` 每块各出片段,`segment.align` 用一个空格连接全部片段,**不去重**;识别句终点被钳到块长(`min(length, u.end_ms)`);跨块的句子起点取前一块、终点取后一块。硬切(`plan_chunks`,没有静音时 40 s)可能切开一个词。 |
| 低速句子(4–5 字符 / 秒)在 v1 里可能的来源 | 代码里有四处:`segment._merge_short` 合并不看间隔(`_merged` 取 min / max);识别句的起止包含句内停顿;不可信块整块按 `speech_span` 平摊;识别句内按字符插值。用户那条素材究竟是哪一处**未验证**:`chunks.json` 在 ready 时随 `_tmp` 删除,没有可复查的数据(本计划 R-V8 修正这一点)。 |
| 识别服务返回的词 | `asr_stream.parse_utterances` 只取 `text/start_time/end_time`,丢掉 `words` 与 `additions`,`definite == false` 的识别句被丢掉;探针(`scripts/asr_timing_probe.py`)只记录了 `words` 的字段名 `end_time, start_time, text`,**没有记录词时间的基准与数值**(Task 0 v2 补)。 |
| 「识别为空」的处理 | `asr._try_stream`:有回落(`whisper_fallback_configured`)时 `empty` 返回 `None` → 调用 chat / Whisper 回落(再计费一次,且可能在音乐上「编」出文字);没有回落时返回空文本。用户实测 3 块都是 `empty` 且回落也为空。 |
| 网页播放缓冲 | `web/src/features/library/use-media-player.ts`:`PAD_BEFORE_MS = 150`、`PAD_AFTER_MS = 250`,与相邻句无关(`startOf(seg)`、`tick` 里 `seg.endMs + PAD_AFTER_MS`)。 |
| 存储的句子时间的约束 | `routers/library.py::patch_segment` 要求 `prev.end <= start < end <= next.start`(最后一句 `<= duration`)。这个检查每次都做(只改文字时用现有的起止检查),所以服务端写入的句子必须不重叠、`end > start`、最后一句不超过素材长度,否则用户连「只改文字」都会 400 `Invalid sentence times`。`wordseg` 保证这三条(`test_library_sentences.py`、`test_library_wordseg.py` 钉住)。 |
| `write_segments` 与译文 | 先删后写,译文 / 分析全部丢失(重新识别时符合 R-R5);成绩按 `text_hash` 跟着文字走。本计划给它加 `keep_ai`(只在「重新分句」时用)。 |
| 删除与备份 | `store.delete_item` → `paths.remove_item_files` 删条目目录与 `_tmp`;`admin/users_admin.py` → `remove_user_files` 删整个用户目录;`admin/backups.py` 只备份数据库。`transcript.json` 放在条目目录里即可随之删除、不进备份。 |
| 需不需要迁移 | 需要,且只要两列:每句标记必须跟着句子行(列表与详情都要,按句子行读写);`item_out` 是纯函数(不读磁盘),要告诉网页能不能「重新分句」只能放一列。`library_bytes` 不改(R-V8)。 |
| 契约与网页类型 | `tests/test_library_store.py`、`test_library_media_api.py` 用整字典比较 `segment_out`,`test_item_out_shape_and_upload_progress` 比较 `item_out` 键集合;网页 `library-contract.test.ts` 用 `Record<keyof T, true>` 绑定键表,`attempts-contract.test.ts` 要求 `patchSegment` 原样带回回包里的字段。新字段在网页类型里设为**可选**,既有测试里的对象字面量不用改。 |
| 镜像里的脚本 | `server/Dockerfile` 不复制 `scripts/`;探针与评估脚本用 `docker compose cp` 拷进运行中的容器、`exec -e PYTHONPATH=/app` 运行(与 v1 的 Task 0 相同)。镜像里有 ffmpeg;数据目录是 `/data`(`docker-compose.example.yml` 的卷)。 |
| 数据库会话里的旧句子 | 「重新分句」先读旧句子(保留译文)再批量删除:写计划时在副本里实测,读出的对象先 `session.expunge` 再删再加,同主键不冲突(`test_rebuild_replaces_edits_but_keeps_translations_of_unchanged_sentences`)。 |

## 本计划的裁定

- **R-V1 词的形状与基准:** `utterances[].words[{text, start_time, end_time}]`,毫秒,**与识别句同一基准**(相对所发音频起点)。基准**未验证**,由 Task 0 的 `words_inside_their_utterance` 判定;若实测是「相对识别句起点」,只改 `asr_stream.parse_words`:调用处传入识别句起点并加到每个词上(G1 的 B2 分支),其余代码不变。无文字 / 时间不合法 / 终点早于起点的词丢掉;长度为 0 的词保留(由检查判断)。
- **R-V2 词元:** 识别句文字按空白切开(保留标点);对齐规则见设计 §2.1;对上的取词的 `min(start)` / `max(end)`;让时间倒退的匹配作废;对上的不到一半 → 整句 `interp`。
- **R-V3 回落层次:** 可信判定仍是 v1 的 `usable_utterances`(R-A4,不改);词超出识别句 ±300 ms 不采信;不可信 / 只有文字的块 → `est`(v1 估算,`speech_span` 内按字符摊)。
- **R-V4 钳位:** 所有时间钳在所发音频 `[0, 块长]` 内再加块起点。
- **R-V5 重叠:** 只在硬切处,`ASR_HARD_CUT_OVERLAP_MS = 2_000`,只在 `PipelineDeps.timed_transcriber` 不为 `None` 时;已存在的 `chunks.json`(断点续传)按原计划继续,不重新规划。费用见设计 §3。
- **R-V6 接缝:** 时间去重(`EDGE_GUARD_MS = 400`、最大净空点、中点归属);一致性 `SEAM_AGREEMENT = 0.6`;文字去重至少 2 个词、最多看 20 个词。
- **R-V7 `chunks.json` 版本 3:** 识别句多一个可选的 `words`(`[[text, start_ms, end_ms], ...]`),紧凑 JSON;仍读版本 1、2;未知版本 → `None`(既有测试把「不认识」改成版本 4)。
- **R-V8 保留识别结果:** 见设计 §9;文件名常量 `pipeline.TRANSCRIPT = "transcript.json"`;只要是 `sub_source == "asr"` 的处理(包括只有文字的识别)都写,`rebuildable = True`;其他来源不写并删除旧文件;不计入 `library_bytes`(< 0.2%,配额以 MB 计)。
- **R-V9 总入口:** `sentences.build(chunks, silences) -> Built(sentences, flags, low_confidence, algorithm)`;`timeline.has_words` 为真走词路径,否则 `build_v1`(v1 原样 + `trim_text_overlaps`)。流水线与「重新分句」都只调它。
- **R-V10 断句常量:** `HARD_PAUSE_MS = 2_000`、`SOFT_PAUSE_MS = 1_000`、`MIN_SPLIT_WORDS = 2`、`MAX_MS = 14_000`、`MAX_WORDS = 40`、`PREFERRED_GAP_MS = 400`、`MIN_MS = 1_000`、`MIN_WORDS = 3`、`MERGE_GAP_MS = 700`;没有字母的词元跟前一句。
- **R-V11 余量:** 服务端 `LEAD_PAD_MS = 40`、`TAIL_PAD_MS = 80`、`PAD_GAP_SHARE = 0.4`、`MIN_SPAN_MS = 200`;网页 `leadOf` / `tailOf`:有空隙且空隙 < 缓冲时用空隙,否则原缓冲。所有数值**未验证**,用金标准的带符号偏差校准。
- **R-V12 识别为空:** 跟读库的 `make_timed_transcriber(..., final_empty=True)`:流式结果为空 → `TimedText("")`,不回落;其他失败照旧回落。别的调用方(上传识别、按住说话、通话)不变。
- **R-V13 检查常量:** `ROBUST_Z = 3.5`、`MAD_FLOOR = 0.05`、`MIN_RATE_CHARS = 12`、`MIN_RATE_SAMPLES = 8`、`FALLBACK_CPS = (5, 35)`、`ARTICULATION_GAP_MS = 300`、`PAUSE_FLAG_MS = 1_500`、`MIN_WORD_SAMPLES = 20`、`SUSPECT_SHARE = 0.3`、`ITEM_FLAG_SHARE = 0.15`。v1 路径仍用 v1 的检查(估算出来的条目本来就该提示)。
- **R-V14 每句标记:** `library_segments.flags`(`VARCHAR(48)`,逗号分隔,按 `FLAG_ORDER`;空 = `NULL`);`segment_out` 输出 `"flags": [...]`;`PATCH segments` 改了起止就清空(服务端与网页 `mergeSaved` 同一规则),只改文字不清;条目的 `low_confidence` 不因手动修改而变(沿用 R-Q2)。
- **R-V15 迁移 `0020`:** `library_segments.flags` 可空;`library_items.rebuildable` `NOT NULL DEFAULT false`;降级 batch。
- **R-V16 重新分句端点:** `POST /api/library/items/{item_id}/rebuild`,`limited_user`(每分钟限流);条件不满足或文件不可读 → 409 `Item cannot be rebuilt`(`not_rebuildable`);回包 `{item, segments}`;不改 `status`,同步完成;日志只有 id、算法名与数字。
- **R-V17 重新识别:** 状态机不变(v1 R-R1…R-R6);成功后替换 `transcript.json` 并把 `rebuildable` 置 true;失败 / 取消不碰旧文件。
- **R-V18 `additions`:** 不使用;Task 0 只记录键名。
- **R-V19 网页:** 新字段可选(`rebuildable?`、`flags?`);⋯ 菜单:`rebuildable` 的自动识别条目即使服务端关了转写也显示「重新分句」;「重新识别」仍只在 `config.asr` 时;可疑句在列表里显示一个琥珀色小圆点(`role="img"` + 文字标签),不加新组件、不改播放页其他布局。
- **R-V20 评估目标:** 见设计 §10;评估脚本输出 PASS / FAIL,只作参考,不进 CI。

## 文件结构与共享文件风险

```
server/
  scripts/asr_words_probe.py                    新(T0)
  scripts/library_alignment_eval.py             新(T10)
  alembic/versions/0020_library_word_alignment.py  新(T6)
  app/models.py                                 [改] LibrarySegment.flags、LibraryItem.rebuildable(T6)
  app/speech/timed.py                           [改] Word、Utterance.words(T1)
  app/speech/asr_stream.py                      [改] parse_words(T1)
  app/speech/asr.py                             [改] final_empty(T1)
  app/library/limits.py                         [改] ASR_HARD_CUT_OVERLAP_MS(T2)
  app/library/asr_chunks.py                     [改] 重叠、状态 v3、transcript(T2)
  app/library/timeline.py                       新(T3)
  app/library/wordseg.py                        新(T4)
  app/library/quality.py                        [改] v2 检查(T5)
  app/library/sentences.py                      新(T5)
  app/library/store.py                          [改] item_out、segment_out、write_segments(T6)
  app/library/errors.py                         [改] not_rebuildable(T8)
  app/library/pipeline.py                       [改] 重叠、总入口、保留识别结果(T7)
  app/library/worker.py                         [改] final_empty(T7)
  app/routers/library.py                        [改] rebuild、换字幕、改时间清标记(T8)
  tests/library_words.py                        新(T2,测试助手)
  tests/test_asr_words_probe.py                 新(T0)
  tests/test_asr_words.py                       新(T1);tests/test_asr_stream_timed.py [改](T1)
  tests/test_library_chunks_v3.py               新(T2);tests/test_library_asr_timed.py [改](T2)
  tests/test_library_timeline.py                新(T3)
  tests/test_library_wordseg.py                 新(T4)
  tests/test_library_quality_v2.py、test_library_sentences.py  新(T5)
  tests/test_library_models.py、test_migrations.py、test_library_store.py、test_library_media_api.py  [改](T6)
  tests/test_library_words_pipeline.py          新(T7)
  tests/test_library_rebuild.py                 新(T8);tests/test_library_privacy.py [改](T8)
  tests/test_library_contract.py、fixtures/library_contract.json  [改](T9)
  tests/test_library_alignment_eval.py          新(T10)
web/src/features/library/
  library-api.ts、attempts-api.ts、shadow-panel.tsx、locales/en.json、locales/zh-CN.json  [改](T11)
  library-contract.test.ts、shadow-panel.test.tsx  [改](T11)
  item-menu.tsx、item-card.tsx、library-list-page.tsx、segment-list.tsx、use-media-player.ts(+ 各自测试)  [改](T12)
docs/superpowers/plans/2026-10-14-library-alignment-v2-results.md   新(T0),T13 追加
server/CLAUDE 文档:app/CLAUDE.md、app/library/CLAUDE.md、app/speech/CLAUDE.md、app/routers/CLAUDE.md、scripts/CLAUDE.md、tests/CLAUDE.md  [改](T13)
```

共享文件风险:(1) `library_contract.json` 只由 T9 重录;(2) `tests/library_helpers.py` 不改(新助手放在 `tests/library_words.py`);(3) `use-media-player.ts` 的缓冲改动影响字幕条目时只在「有空隙且空隙小于缓冲」的情况下(字幕 cue 常首尾相接,不受影响);(4) 进行中的其他计划若也改 `routers/library.py` 或 `store.py`,按锚点合并,先合并者为准。

---

# Task 0:词级时间探针(手动运行;花钱的部分有两道关口)

**目的:** 不写任何产品代码,回答 G1 的问题:① `words` 是否稳定出现、字段名;② 词时间的基准(相对所发音频 / 相对识别句);③ 词与识别句文字能否对齐(数字规范化的影响);④ 时间的颗粒度;⑤ 词长与词间隔的分布(断句阈值的依据);⑥ v1 的句边界离词有多远(诊断 v1);⑦ 同一段音频识别两次(整段 / 半段)的跨次抖动、半段边缘的词是否被切(接缝设计的依据);⑧ `additions` 的键名。

**Files:** Create `server/scripts/asr_words_probe.py`、`server/tests/test_asr_words_probe.py`、`docs/superpowers/plans/2026-10-14-library-alignment-v2-results.md`。

**花费:** 每段素材 3 次请求(整段 + 两个各多 1 s 的半段),约为素材长度的 2 倍;两段 60 s 素材合计约 4 分钟识别时长。脚本没有 `--yes` 拒绝运行,`--seconds` 限 20–90。密钥只在容器里经 `Settings()` 读,不打印;输出只有字段名、条数、毫秒数(文字只在内存里用来对齐与跑 v1 的切句器,从不打印)。

- [ ] **Step 1:写测试(先红)** `server/tests/test_asr_words_probe.py`:

```python
"""Task 0 探针(plan 2026-10-14-library-alignment-v2)的纯函数与隐私:只输出字段名、条数、毫秒数,从不输出文字。"""
import pytest

from scripts.asr_words_probe import (
    main, pct, render, seam_stats, shift, time_grid, utterances_of, v1_offsets, word_stats,
)

SECRET = "SECRET-TRANSCRIPT"


def words(*rows):
    return [{"text": t, "start_time": s, "end_time": e} for t, s, e in rows]


RESULT = {"utterances": [
    {"text": f"{SECRET} one, two.", "start_time": 10_000, "end_time": 11_400, "definite": True, "additions": {"x": 1},
     "words": words((SECRET, 10_000, 10_400), ("one,", 10_450, 10_800), ("two", 10_850, 11_400))},
    {"text": "Three four five.", "start_time": 14_000, "end_time": 17_500, "definite": True,
     "words": words(("three", 14_000, 14_300), ("four", 16_200, 16_500), ("five", 16_550, 17_500))},
    "junk",
]}


def test_utterances_keep_numbers_and_field_names():
    utts = utterances_of(RESULT)
    assert len(utts) == 2 and utts[0]["fields"] == ["additions", "definite", "end_time", "start_time", "text", "words"]
    assert utts[0]["word_fields"] == ["end_time", "start_time", "text"] and utts[0]["addition_fields"] == ["x"]
    assert utts[0]["words"][1] == ("one", 10_450, 10_800, True)
    assert utterances_of(None) == [] and utterances_of({"utterances": "x"}) == []


def test_word_stats():
    st = word_stats(utterances_of(RESULT))
    assert (st["utterances"], st["words"], st["words_inside_their_utterance"], st["words_monotonic"]) == (2, 6, 6, True)
    assert st["time_grid_ms"] == 50 and st["gaps_over_1000"] == 1 and st["inner_max_gap_max"] == 1900
    assert st["word_punct"] == 2 and st["token_word_match"] == 1.0 and st["dur_zero"] == 0


def test_v1_offsets_measure_how_far_sentences_sit_from_their_words():
    v1 = v1_offsets(utterances_of(RESULT))
    assert v1["v1_sentences"] >= 1 and v1["v1_edge_max"] is not None and v1["v1_with_gap_over_1500"] == 1


def test_seam_stats_measure_cross_run_jitter():
    whole = utterances_of(RESULT)
    left = utterances_of({"utterances": [{"text": "x", "start_time": 10_000, "end_time": 11_400, "words": words(
        ("one", 10_470, 10_810), ("two", 10_860, 11_380))}]})
    right = shift(utterances_of({"utterances": [{"text": "x", "start_time": 0, "end_time": 1_400, "words": words(
        ("one", 430, 790), ("two", 850, 1_400))}]}), 10_000)
    seam = seam_stats(whole, left, right, 10_700)
    assert seam["seam_matched_left"] == 2 and seam["seam_matched_right"] == 2
    assert seam["jitter_max"] == 20 and seam["left_edge_word_cut"] is False


def test_the_markdown_never_contains_the_transcript():
    utts = utterances_of(RESULT)
    block = render("A-music", 60_000, {k: utts[0][k] for k in ("fields", "word_fields", "addition_fields")},
                   word_stats(utts), v1_offsets(utts), seam_stats(utts, utts, utts, 10_700))
    assert SECRET not in block and SECRET.lower() not in block and "A-music" in block and "jitter_p50" in block


def test_helpers():
    assert pct([], 50) is None and pct([3, 1, 2], 50) == 2 and pct([1, 2, 3, 4], 95) == 4
    assert time_grid([10_000, 10_450, 10_800]) == 50 and time_grid([]) == 0


@pytest.mark.parametrize("argv", [["--clip", "x.mp3"], ["--clip", "x.mp3", "--yes", "--seconds", "5"],
                                  ["--clip", "missing.mp3", "--yes"]])
def test_it_refuses_without_yes_bad_seconds_or_a_missing_clip(argv):
    assert main(argv) == 2
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_asr_words_probe.py`。预期:`ModuleNotFoundError: scripts.asr_words_probe`。
- [ ] **Step 3:写脚本** `server/scripts/asr_words_probe.py`(复用同目录 `asr_timing_probe.py` 的 `decode_clip` / `read_pcm` / `collect_frames` / `field_names` / `number`;容器里两个文件都拷到 `/tmp`):

```python
"""Task 0 of plan 2026-10-14-library-alignment-v2: are the recognizer's WORD times good enough to cut sentences on?

Run BY HAND inside the running server container, one clip of about a minute per run (two runs: one clip that starts with
background music, one fast-speech clip). Each run sends THREE recognition requests: the whole clip, then two halves
that overlap by 2 s around the middle (about 2 x the clip length of recognition in total, so ~4 minutes for two 60 s
clips). It refuses to start without --yes.

It prints only field NAMES, counts and numbers (ms): never the key, the URL, a transcript or any text from a response.
`--append-to` appends the same Markdown block to the results document.

    docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
    docker compose cp server/scripts/asr_words_probe.py server:/tmp/asr_words_probe.py
    docker compose cp ./clip-a.mp3 server:/tmp/clip-a.mp3
    docker compose exec -e PYTHONPATH=/app server python /tmp/asr_words_probe.py --clip /tmp/clip-a.mp3 --label A-music --yes
    docker compose exec -u root server rm -f /tmp/asr_timing_probe.py /tmp/asr_words_probe.py /tmp/clip-a.mp3
"""
import argparse
import asyncio
import math
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # the sibling asr_timing_probe.py (container: /tmp)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the server package when run from the repo

import asr_timing_probe as base  # noqa: E402

OVERLAP_MS = 2_000
SEAM_WINDOW_MS = 600  # words whose middle is this close to the split point are compared between the runs
EDGE_MS = 50


# ---- pure helpers (unit-tested; they return numbers and field names only) ----

def norm(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def utterances_of(result: object) -> list[dict]:
    """[{text, tokens, chars, start, end, definite, words: [(normalized text, start, end, has punctuation)], fields,
    word_fields, addition_fields}]. `text` / `tokens` stay in memory for matching and for v1's splitter; nothing that
    holds text is ever printed (`render` takes numbers and field names only)."""
    raw = result.get("utterances") if isinstance(result, dict) else None
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, start, end = item.get("text"), base.number(item.get("start_time")), base.number(item.get("end_time"))
        words = []
        for w in item.get("words") if isinstance(item.get("words"), list) else []:
            if not isinstance(w, dict):
                continue
            ws, we = base.number(w.get("start_time")), base.number(w.get("end_time"))
            wt = w.get("text")
            if ws is None or we is None or not isinstance(wt, str):
                continue
            words.append((norm(wt), ws, we, any(not c.isalnum() and not c.isspace() for c in wt)))
        additions = item.get("additions")
        out.append({
            "text": " ".join(text.split()) if isinstance(text, str) else "",
            "chars": len(text) if isinstance(text, str) else 0,
            "tokens": [norm(t) for t in text.split()] if isinstance(text, str) else [],
            "start": start, "end": end, "definite": item.get("definite"), "words": words,
            "fields": base.field_names(item),
            "word_fields": base.field_names(item["words"][0]) if isinstance(item.get("words"), list) and item["words"]
            and isinstance(item["words"][0], dict) else [],
            "addition_fields": base.field_names(additions),
        })
    return out


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))]


def time_grid(values: list[float]) -> int:
    """The greatest common divisor of all times in ms (10 = times come in 10 ms steps); 0 for none."""
    g = 0
    for v in values:
        g = math.gcd(g, int(round(v)))
    return g


def word_stats(utts: list[dict]) -> dict:
    words = [w for u in utts for w in u["words"]]
    durations = [e - s for _t, s, e, _p in words]
    gaps, inner_max = [], []
    for u in utts:
        ws = u["words"]
        g = [max(0.0, b[1] - a[2]) for a, b in zip(ws, ws[1:])]
        gaps += g
        inner_max.append(max(g, default=0.0))
    inside = sum(1 for u in utts for _t, s, e, _p in u["words"]
                 if u["start"] is not None and u["end"] is not None and u["start"] - 300 <= s and e <= u["end"] + 300)
    starts = [s for _t, s, _e, _p in words]
    matched = total = 0
    for u in utts:
        sm = SequenceMatcher(None, u["tokens"], [t for t, *_ in u["words"]], autojunk=False)
        matched += sum(size for _a, _b, size in sm.get_matching_blocks())
        total += len(u["tokens"])
    return {
        "utterances": len(utts), "words": len(words),
        "utterances_with_words": sum(1 for u in utts if u["words"]),
        "words_inside_their_utterance": inside,
        "words_monotonic": all(a <= b for a, b in zip(starts, starts[1:])),
        "time_grid_ms": time_grid([x for _t, s, e, _p in words for x in (s, e)]),
        "dur_p5": pct(durations, 5), "dur_p50": pct(durations, 50), "dur_p95": pct(durations, 95),
        "dur_zero": sum(1 for d in durations if d <= 0), "dur_under_30": sum(1 for d in durations if 0 < d < 30),
        "dur_over_1500": sum(1 for d in durations if d > 1500),
        "gap_p50": pct(gaps, 50), "gap_p90": pct(gaps, 90), "gap_p99": pct(gaps, 99),
        "gaps_over_1000": sum(1 for g in gaps if g > 1000), "gaps_over_2000": sum(1 for g in gaps if g > 2000),
        "inner_max_gap_p50": pct(inner_max, 50), "inner_max_gap_max": max(inner_max, default=None),
        "word_punct": sum(1 for *_x, p in words if p),
        "token_word_match": round(matched / total, 3) if total else None,
        "definite_false": sum(1 for u in utts if u["definite"] is False),
    }


def v1_offsets(utts: list[dict]) -> dict:
    """How far v1's sentences (utterance spans split by characters, `app.library.segment.build`) sit from the words they
    contain: lead = first word start - sentence start, tail = sentence end - last word end (ms; > 0 = silence or music
    inside the sentence). Sentences that contain no word count as `empty`."""
    from app.library.segment import Fragment, build

    frags = [Fragment(round(u["start"]), round(u["end"]), u["text"]) for u in utts
             if u["start"] is not None and u["end"] is not None and u["text"]]
    sentences = build(frags)
    words = [(s, e) for u in utts for _t, s, e, _p in u["words"]]
    leads, tails, empty, gapped = [], [], 0, 0
    for s in sentences:
        inside = [(a, b) for a, b in words if s.start_ms <= (a + b) / 2 <= s.end_ms]
        if not inside:
            empty += 1
            continue
        leads.append(inside[0][0] - s.start_ms)
        tails.append(s.end_ms - inside[-1][1])
        if any(b2[0] - a2[1] > 1500 for a2, b2 in zip(inside, inside[1:])):
            gapped += 1
    absolute = [abs(x) for x in leads + tails]
    return {"v1_sentences": len(sentences), "v1_empty": empty, "v1_with_gap_over_1500": gapped,
            "v1_edge_p50": pct(absolute, 50), "v1_edge_p95": pct(absolute, 95), "v1_edge_max": max(absolute, default=None),
            "v1_edges_over_300": sum(1 for x in absolute if x > 300)}


def seam_stats(whole: list[dict], left: list[dict], right: list[dict], split_ms: int) -> dict:
    """Words near `split_ms` as heard by the whole-clip run and by the two halves (right-half times already shifted to
    the clip's time base). Matched by text in order; |delta| in ms between runs is the cross-run jitter."""
    def near(utts):
        return [(t, s, e) for u in utts for t, s, e, _p in u["words"] if abs((s + e) / 2 - split_ms) <= SEAM_WINDOW_MS]

    def deltas(a, b):
        sm = SequenceMatcher(None, [t for t, *_ in a], [t for t, *_ in b], autojunk=False)
        out = []
        for i, j, size in sm.get_matching_blocks():
            for k in range(size):
                out += [abs(a[i + k][1] - b[j + k][1]), abs(a[i + k][2] - b[j + k][2])]
        return out, sum(size for *_x, size in sm.get_matching_blocks())

    w, l, r = near(whole), near(left), near(right)
    d_left, m_left = deltas(w, l)
    d_right, m_right = deltas(w, r)
    jitter = d_left + d_right
    left_edge = split_ms + OVERLAP_MS // 2
    return {"seam_words_whole": len(w), "seam_matched_left": m_left, "seam_matched_right": m_right,
            "jitter_p50": pct(jitter, 50), "jitter_p95": pct(jitter, 95), "jitter_max": max(jitter, default=None),
            "left_edge_word_cut": any(e >= left_edge - EDGE_MS for u in left for _t, _s, e, _p in u["words"])}


def shift(utts: list[dict], offset_ms: int) -> list[dict]:
    return [{**u, "start": None if u["start"] is None else u["start"] + offset_ms,
             "end": None if u["end"] is None else u["end"] + offset_ms,
             "words": [(t, s + offset_ms, e + offset_ms, p) for t, s, e, p in u["words"]]} for u in utts]


def render(label: str, audio_ms: int, fields: dict, stats: dict, v1: dict, seam: dict | None) -> str:
    def row(d: dict) -> str:
        return ";".join(f"{k} {v}" for k, v in d.items())

    lines = [f"### 素材 {label}(音频 {audio_ms / 1000:.1f} s)", "",
             f"- 字段:utterance {', '.join(fields['fields']) or '(无)'};words {', '.join(fields['word_fields']) or '(无)'};"
             f"additions {', '.join(fields['addition_fields']) or '(无)'}",
             f"- 词:{row(stats)}", f"- v1 句边界离词的距离(ms):{row(v1)}"]
    lines.append(f"- 接缝(两半各多听 1 s):{row(seam)}" if seam else "- 接缝:未运行")
    return "\n".join(lines) + "\n"


# ---- the real run ----

async def recognize(settings, pcm: bytes) -> list[dict]:
    frames, _took = await base.collect_frames(settings, pcm)
    last = next((f for f in reversed(frames) if f.get("last")), None)
    payload = last.get("payload") if last else None
    return utterances_of(payload.get("result") if isinstance(payload, dict) else None)


async def run(args: argparse.Namespace) -> int:
    import tempfile

    from app.core.config import Settings

    settings = Settings()
    if not settings.asr_stream_key:
        print("the streaming recognition key is not configured", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as tmp:
        try:
            wav = base.decode_clip(Path(args.clip), args.seconds, Path(tmp)).read_bytes()
        except Exception as e:  # noqa: BLE001 - class name only
            print(f"ffmpeg failed: {type(e).__name__}", file=sys.stderr)
            return 1
    pcm, audio_ms = base.read_pcm(wav)
    bytes_per_ms = 32  # 16 kHz, 16-bit mono
    try:
        whole = await recognize(settings, pcm)
        split = audio_ms // 2
        left_end, right_start = split + OVERLAP_MS // 2, split - OVERLAP_MS // 2
        left = await recognize(settings, pcm[:left_end * bytes_per_ms])
        right = shift(await recognize(settings, pcm[right_start * bytes_per_ms:]), right_start)
    except Exception as e:  # noqa: BLE001
        print(f"recognition failed: {type(e).__name__}", file=sys.stderr)
        return 1
    first = next((u for u in whole if u["words"]), whole[0] if whole else None)
    fields = {k: (first[k] if first else []) for k in ("fields", "word_fields", "addition_fields")}
    block = render(args.label, audio_ms, fields, word_stats(whole), v1_offsets(whole), seam_stats(whole, left, right, split))
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--clip", required=True, help="audio or video file readable by ffmpeg (inside the container)")
    p.add_argument("--label", default="clip", help="short name for the results block, e.g. A-music")
    p.add_argument("--seconds", type=int, default=base.DEFAULT_SECONDS, help=f"first N seconds only (20-{base.MAX_SECONDS})")
    p.add_argument("--yes", action="store_true", help="really spend recognition quota (about 2 x --seconds)")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.yes:
        print("refusing to spend recognition quota without --yes", file=sys.stderr)
        return 2
    if not 20 <= args.seconds <= base.MAX_SECONDS:
        print(f"--seconds must be 20-{base.MAX_SECONDS}", file=sys.stderr)
        return 2
    if not Path(args.clip).is_file():
        print("clip not found", file=sys.stderr)
        return 2
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4:跑测试变绿:** `cd server && uv run pytest -q tests/test_asr_words_probe.py tests/test_asr_timing_probe.py`(写计划时实测 9 + 13 通过)。
- [ ] **Step 5:提交脚本与测试:**

```
feat(server): word-timing probe for the library alignment v2 spike

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

- [ ] **Step 6:建结果文档。** Write `docs/superpowers/plans/2026-10-14-library-alignment-v2-results.md`:

```markdown
# 跟读库句边界 v2 · 结果与核对(plans/2026-10-14-library-alignment-v2.md)

只写数字、字段名与结论;不写转写文字、标题、密钥、URL。

## Task 0 词级时间探针

- 日期 / 基于提交:PENDING
- 识别路径:PENDING(`UPSTREAM_ASR_MODE`、`asr_stream_url` 的路径末段;不写密钥与主机)
- 素材:PENDING(只写来源类型与时长,例如「已导入库视频开头 60 s,持续背景音乐」)
```

- [ ] **Step 7:关口 G0 —— 停,取得用户的明确同意再花钱。** 在对话里告诉用户(原文照此说,不要替用户决定):

> Task 0 要对**两段约 60 秒**的素材各做 **3 次**真实识别(整段 1 次 + 两个半段各 1 次,半段在中点前后各多 1 秒),合计约 **4 分钟**识别时长,会计入今天的识别用量。建议素材:A = 你那条 vlog 的开头 60 s(背景音乐);B = 同一视频里语速最快的一段 60 s。密钥只在容器里读、不打印;不重建镜像、不重启容器(只用 `docker compose cp` 与 `exec`);输出只有数字与字段名。要运行吗?

**没有用户在对话里的明确同意,不要运行 Step 8。** 执行者没有容器访问权限时,把 Step 8 的命令原样交给用户,在结果文档里写 `PENDING(未运行:需要用户在容器里执行)`,然后**停在 G0**(T1 可以先做,它与结果无关)。

- [ ] **Step 8:运行(用户同意后;仓库根目录;素材先在容器里用 ffmpeg 从已导入的媒体切出,或从本机拷入):**

```bash
docker compose cp server/scripts/asr_timing_probe.py server:/tmp/asr_timing_probe.py
docker compose cp server/scripts/asr_words_probe.py server:/tmp/asr_words_probe.py
docker compose cp ./clip-a.mp3 server:/tmp/clip-a.mp3
docker compose cp ./clip-b.mp3 server:/tmp/clip-b.mp3
docker compose exec -e PYTHONPATH=/app server python /tmp/asr_words_probe.py --clip /tmp/clip-a.mp3 --label A-music --yes
docker compose exec -e PYTHONPATH=/app server python /tmp/asr_words_probe.py --clip /tmp/clip-b.mp3 --label B-fast --yes
docker compose exec -u root server rm -f /tmp/asr_timing_probe.py /tmp/asr_words_probe.py /tmp/clip-a.mp3 /tmp/clip-b.mp3
```

  (v1 的 Task 0 报告:`docker compose cp` 拷进去的文件属 root,删除要 `-u root`。)

- [ ] **Step 9:把两段输出贴进结果文档,并写 G1 结论。** 在 Step 6 的文件末尾追加两个 `### 素材 …` 块(脚本输出原样)和下面这张表(填实测值):

```markdown
### G1 结论

| 判据 | 要求 | A | B | 结果 |
|---|---|---|---|---|
| 有词的识别句占比 `utterances_with_words / utterances` | >= 0.9 | | | |
| 词落在所属识别句 ±300 ms 内 `words_inside_their_utterance / words` | >= 0.98 | | | |
| 词起点单调 `words_monotonic` | True | | | |
| 时间颗粒 `time_grid_ms` | <= 40 | | | |
| 词元对上的比例 `token_word_match` | >= 0.85(低于此只是 `interp` 多) | | | |
| 跨次抖动 `jitter_p95`(ms) | <= 150(高于此只降低预期) | | | |
| 半段边缘的词被切 `left_edge_word_cut` | 记录 | | | |
| v1 句边界离词的距离 `v1_edge_p95` / `v1_edges_over_300` | 记录(v1 的诊断) | | | |
| `additions` 键名 | 记录 | | | |
| **G1** | | | | A / B1 / B2 / C |
```

  判定(两段素材都要看):
  - **A** = 前 3 行(有词、词在识别句内、单调)都满足,且时间颗粒 <= 40 ms、对上比例 >= 0.85、抖动 p95 <= 150 ms → 继续 T2…。
  - **B1** = 前 3 行满足,但颗粒、对上比例、抖动三者之一不满足 → 记下,继续,在 T13 的结果文档里把精度预期写低(颗粒或抖动就是误差的下限)。
  - **B2** = 只有「词在识别句内」不满足,且每个词的终点都不超过所属识别句的长度(说明词时间相对识别句起点)→ 按 R-V1 改 `parse_words`:签名加 `offset_ms: int = 0`,每个词的起止加上它;`parse_utterances` 调用时传 `round(start)`;T1 的测试 `test_utterances_carry_their_words_in_the_same_time_base` 按真实形状改写(词时间写成相对值,期望仍是绝对值)。然后按 A / B1 继续。
  - **C** = 「有词」不满足(大多数识别句没有词)或词起点不单调 → **停,把结果交给用户,问是否仍要做 T6–T10(保留识别结果、重新分句、评估,不含词路径)**,不要自作主张继续。

- [ ] **Step 10:提交结果文档:**

```
docs: record the word-timing probe (library alignment v2 Task 0)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 1:语音层 —— `Word`、解析 `words`、`final_empty`

**Files:** Modify `server/app/speech/timed.py`、`server/app/speech/asr_stream.py`、`server/app/speech/asr.py`、`server/tests/test_asr_stream_timed.py`;Create `server/tests/test_asr_words.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_asr_words.py`:

```python
"""词级时间(plan 2026-10-14-library-alignment-v2 R-V1)与「识别为空即没有人声」(R-V12)。"""
import logging

import httpx
import pytest

from app.speech.asr import make_timed_transcriber
from app.speech.asr_stream import AsrStreamError, parse_utterances, parse_words, transcribe_pcm_timed
from app.speech.stt import pcm_to_wav
from app.speech.timed import TimedText, Utterance, Word
from tests.conftest import make_settings
from tests.test_asr_buffered import PCM as BUFFERED_PCM, STREAM, chat_reply
from tests.test_asr_stream import fake, settings_for  # noqa: F401  (`fake` is a fixture)
from tests.test_asr_timed import timed_stream  # noqa: F401  (fixture)

PCM = b"\x00\x00" * 10


@pytest.mark.parametrize("raw, expected", [
    ([{"text": "Hello,", "start_time": 120, "end_time": 480}, {"text": " world ", "start_time": 520.4, "end_time": 900}],
     (Word("Hello,", 120, 480), Word("world", 520, 900))),
    ([{"text": "uh", "start_time": 300, "end_time": 300}], (Word("uh", 300, 300),)),  # zero length: kept, judged later
    ([{"text": "x", "start_time": 500, "end_time": 400}], ()),  # inverted
    ([{"text": "x", "start_time": -1, "end_time": 400}], ()),
    ([{"text": "x", "start_time": True, "end_time": 400}], ()),
    ([{"text": "x", "start_time": "0", "end_time": 400}], ()),
    ([{"text": "  ", "start_time": 0, "end_time": 400}], ()),
    ([{"start_time": 0, "end_time": 400}, "nope", 7, None], ()),
    (None, ()), ("words", ()), ({}, ()),
])
def test_parse_words(raw, expected):
    assert parse_words(raw) == expected


def test_utterances_carry_their_words_in_the_same_time_base():
    raw = {"utterances": [{"text": "Hello, world.", "start_time": 27360, "end_time": 28200, "definite": True,
                           "words": [{"text": "Hello", "start_time": 27360, "end_time": 27700},
                                     {"text": "world", "start_time": 27760, "end_time": 28200}],
                           "additions": {"x": "y"}}]}
    assert parse_utterances(raw) == (Utterance("Hello, world.", 27360, 28200,
                                               (Word("Hello", 27360, 27700), Word("world", 27760, 28200))),)


async def test_the_timed_stream_result_keeps_the_words(fake):  # noqa: F811
    fake.text = "Hi there."
    fake.utterances = [{"text": "Hi there.", "start_time": 100, "end_time": 900, "definite": True,
                        "words": [{"text": "Hi", "start_time": 100, "end_time": 380},
                                  {"text": "there", "start_time": 420, "end_time": 900}]}]
    got = await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert got.utterances[0].words == (Word("Hi", 100, 380), Word("there", 420, 900))


async def test_word_text_never_reaches_the_logs(fake, caplog):  # noqa: F811
    caplog.set_level(logging.DEBUG, logger="app")
    fake.text = "SECRET-TRANSCRIPT here."
    fake.utterances = [{"text": "SECRET-TRANSCRIPT here.", "start_time": 0, "end_time": 900,
                        "words": [{"text": "SECRET-TRANSCRIPT", "start_time": 0, "end_time": 500}]}]
    await transcribe_pcm_timed(settings_for(fake.url), PCM)
    assert all("SECRET-TRANSCRIPT" not in f"{r.getMessage()} {r.args!r}" for r in caplog.records)


async def test_final_empty_means_no_speech_and_never_pays_the_fallback(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("empty")]
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), final_empty=True)(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("", ()) and not route.called


async def test_without_final_empty_an_empty_stream_still_falls_back(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("empty")]
    route = chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM))(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("from chat", ()) and route.called


async def test_final_empty_does_not_swallow_real_failures(respx_mock, timed_stream):  # noqa: F811
    timed_stream.outcomes = [AsrStreamError("upstream")]
    chat_reply(respx_mock)
    async with httpx.AsyncClient() as http:
        got = await make_timed_transcriber(http, make_settings(**STREAM), final_empty=True)(pcm_to_wav(BUFFERED_PCM))
    assert got == TimedText("from chat", ())
```

- [ ] **Step 2:改既有测试的期望。** `tests/test_asr_stream_timed.py`(Edit,三处):
  1. `from app.speech.timed import TimedText, Utterance` → `from app.speech.timed import TimedText, Utterance, Word`
  2. 注释行

```python
# The real shape seen in Task 0 (volc bigmodel_nostream): extra `words` / `additions` fields are ignored.
```

  换成

```python
# The real shape seen in Task 0 (volc bigmodel_nostream): `words` are kept (plan v2 R-V1), `additions` is ignored.
```

  3. 参数表第一行

```python
    ({"utterances": [REAL]}, (Utterance("Hello, world.", 27360, 32550),)),
```

  换成

```python
    ({"utterances": [REAL]}, (Utterance("Hello, world.", 27360, 32550, (Word("Hello,", 27360, 27900),)),)),
```

- [ ] **Step 3:跑一次确认红:** `cd server && uv run pytest -q tests/test_asr_words.py tests/test_asr_stream_timed.py`。预期:`ImportError: cannot import name 'Word'`。
- [ ] **Step 4:`app/speech/timed.py` 整个文件换成:**

```python
"""识别结果「带时间」的形状(plan 2026-10-13-library-alignment R-A2;词级时间见 plan 2026-10-14-library-alignment-v2 R-V1):
纯数据,没有协议细节,只依赖标准库。

`Utterance`:识别服务自己切出的一句(或一段),`start_ms` / `end_ms` 相对**发送出去的那段音频的起点**(跟读库发送的是识别块的
WAV 切片,所以相对块起点,R-A1)。`words`:这一句里每个词的时间,与句子同一个时间基准(v2 Task 0 验证);空 = 识别服务没给。
`TimedText.utterances` 为空 = 这条识别路径没有给时间(Whisper chat 回落、旧协议)。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Utterance:
    text: str
    start_ms: int
    end_ms: int
    words: tuple[Word, ...] = ()


@dataclass(frozen=True)
class TimedText:
    text: str
    utterances: tuple[Utterance, ...] = ()
```

- [ ] **Step 5:`app/speech/asr_stream.py`(Edit,两处):**
  1. `from app.speech.timed import TimedText, Utterance` → `from app.speech.timed import TimedText, Utterance, Word`
  2. `parse_utterances` 末尾

```python
        text = " ".join(text.split())
        if text and start >= 0 and end > start:
            out.append(Utterance(text, round(start), round(end)))
    return tuple(out)
```

  换成

```python
        text = " ".join(text.split())
        if text and start >= 0 and end > start:
            out.append(Utterance(text, round(start), round(end), parse_words(item.get("words"))))
    return tuple(out)


def _ms(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return round(value)


def parse_words(raw: object) -> tuple[Word, ...]:
    """`utterances[].words[{text, start_time, end_time}]` -> `Word`s in ms, same time base as the utterance (plan
    2026-10-14-library-alignment-v2 R-V1; Task 0 checks the base). A word without text or usable times is dropped; a
    zero-length word is kept (the caller judges it). Order is kept as sent."""
    out: list[Word] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, start, end = item.get("text"), _ms(item.get("start_time")), _ms(item.get("end_time"))
        if not isinstance(text, str) or start is None or end is None or end < start:
            continue
        text = " ".join(text.split())
        if text:
            out.append(Word(text, start, end))
    return tuple(out)
```

- [ ] **Step 6:`app/speech/asr.py`(Edit,四处):**
  1. `_try_stream` 的签名

```python
async def _try_stream(settings: Settings, gate: AsrGate, pcm: bytes, uid: str, fallback: bool, *,
                      timed: bool = False) -> str | TimedText | None:
```

  换成

```python
async def _try_stream(settings: Settings, gate: AsrGate, pcm: bytes, uid: str, fallback: bool, *,
                      timed: bool = False, final_empty: bool = False) -> str | TimedText | None:
```

  2. `except AsrStreamError` 分支里

```python
        if not fallback:
            if e.kind == "empty":
                return TimedText("") if timed else ""
            raise _map_stream(e.kind) from None
        return None
```

  换成

```python
        if e.kind == "empty" and (final_empty or not fallback):
            return TimedText("") if timed else ""  # v2 R-V12: with final_empty an empty answer is "no speech", not a reason to fall back
        if not fallback:
            raise _map_stream(e.kind) from None
        return None
```

  3. `make_timed_transcriber` 的参数表末尾(文件里 `uid: str = "server",` 出现三次,连同下一行一起匹配才唯一)

```python
    uid: str = "server",
) -> Callable[[bytes], Awaitable[TimedText]]:
```

  换成

```python
    uid: str = "server",
    final_empty: bool = False,
) -> Callable[[bytes], Awaitable[TimedText]]:
```

  并在它的文档字符串末尾(「错误口径与 `make_transcriber` 相同。」之后、`"""` 之前)接上这一句:

```text
`final_empty=True`(跟读库,v2 R-V12):流式结果为空 = 没有人声,不回落、不再计费。
```
  4. 它里面的调用

```python
                result = await _try_stream(settings, gate, pcm, uid, _fallback_configured(settings), timed=True)
```

  换成

```python
                result = await _try_stream(settings, gate, pcm, uid, _fallback_configured(settings), timed=True,
                                           final_empty=final_empty)
```

- [ ] **Step 7:跑测试:** `cd server && uv run pytest -q tests/test_asr_words.py tests/test_asr_stream_timed.py tests/test_asr_timed.py tests/test_asr_stream.py tests/test_asr_buffered.py tests/test_architecture.py`(写计划时实测 154 通过)。
- [ ] **Step 8:提交:**

```
feat(server): keep the recognizer's word times; an empty library chunk means no speech

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 2:识别块 v3 —— 硬切处重叠、状态文件带词、保留识别结果

**Files:** Modify `server/app/library/limits.py`、`server/app/library/asr_chunks.py`、`server/tests/test_library_asr_timed.py`;Create `server/tests/library_words.py`、`server/tests/test_library_chunks_v3.py`。

- [ ] **Step 1:测试助手** `server/tests/library_words.py`(新):

```python
"""v2 测试助手(plan 2026-10-14-library-alignment-v2):按「每个词多长、词间隔多长」造带词级时间的识别句与块。纯数据,不碰网络。
`tok` / `run` 造 `timeline.Token`(Task 3 才有这个模块,所以在函数里导入)。"""
from typing import TYPE_CHECKING

from app.library.asr_chunks import Chunk
from app.speech.timed import Utterance, Word

if TYPE_CHECKING:
    from app.library.timeline import Token


def words_at(text: str, start_ms: int, word_ms: int = 300, gap_ms: int = 60, gaps: dict[int, int] | None = None) -> list[Word]:
    """One word per whitespace token (punctuation stripped from the word, like the recognizer), `word_ms` long, `gap_ms`
    apart; `gaps` = {token index: gap in ms AFTER that token} overrides single gaps (long pauses)."""
    out: list[Word] = []
    t = start_ms
    for i, tok in enumerate(text.split()):
        out.append(Word(tok.strip(".,!?;:"), t, t + word_ms))
        t += word_ms + (gaps or {}).get(i, gap_ms)
    return out


def utt(text: str, start_ms: int, **kw) -> Utterance:
    """A recognizer sentence whose span is exactly its words' span."""
    ws = words_at(text, start_ms, **kw)
    return Utterance(text, ws[0].start_ms, ws[-1].end_ms, tuple(ws))


def chunk(start_ms: int, end_ms: int, *utts: Utterance) -> Chunk:
    """A transcribed chunk: utterance times are given relative to the chunk start (as the recognizer sends them)."""
    return Chunk(start_ms, end_ms, " ".join(u.text for u in utts), list(utts))


def tok(text: str, start_ms: int, end_ms: int, kind: str = "word", seam: bool = False) -> "Token":
    from app.library.timeline import Token

    return Token(text, start_ms, end_ms, kind, seam)


def run(texts: list[str], start_ms: int = 0, word_ms: int = 300, gap_ms: int = 60,
        gaps: dict[int, int] | None = None) -> list["Token"]:
    """Word tokens laid out like `words_at`, already in absolute ms."""
    from app.library.timeline import Token

    out: list[Token] = []
    t = start_ms
    for i, text in enumerate(texts):
        out.append(Token(text, t, t + word_ms, "word"))
        t += word_ms + (gaps or {}).get(i, gap_ms)
    return out
```

- [ ] **Step 2:写测试(先红)** `server/tests/test_library_chunks_v3.py`:

```python
"""识别块 v3(plan 2026-10-14-library-alignment-v2 R-V5、R-V7、R-V8):硬切处重叠、状态文件带词、保留的识别结果。"""
import json

from app.library import asr_chunks as ac
from app.speech.timed import Utterance
from tests.library_words import chunk, utt


def test_hard_cuts_overlap_and_silence_cuts_do_not():
    assert [(c.start_ms, c.end_ms) for c in ac.plan_chunks(100_000, [], overlap_ms=2_000)] == [
        (0, 41_000), (39_000, 80_000), (78_000, 100_000)]
    silent = [ac.Silence(29_800, 30_400)]
    assert ac.plan_chunks(60_000, silent, overlap_ms=2_000) == ac.plan_chunks(60_000, silent)
    assert [(c.start_ms, c.end_ms) for c in ac.plan_chunks(100_000, [])] == [(0, 40_000), (40_000, 80_000), (80_000, 100_000)]


def test_fifteen_minutes_without_any_silence_costs_about_five_percent_more_with_overlap():
    """The worst case quoted in the plan (every cut is a hard cut): 900 s -> 944 s; 3 s would cost 981 s."""
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [])) == 900
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [], overlap_ms=2_000)) == 944
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [], overlap_ms=3_000)) == 981


def test_state_v3_keeps_words_and_still_reads_v1_and_v2(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [chunk(0, 40_000, utt("Hello there.", 1_000)), ac.Chunk(40_000, 50_000, "x", []), ac.Chunk(50_000, 60_000)]
    ac.save_state(path, chunks)
    assert json.loads(path.read_text("utf-8"))["version"] == 3 and ac.load_state(path) == chunks
    path.write_text('{"version": 2, "chunks": [{"start_ms": 0, "end_ms": 9, "text": "a", "utterances": '
                    '[{"text": "a", "start_ms": 1, "end_ms": 5}]}]}', encoding="utf-8")
    assert ac.load_state(path) == [ac.Chunk(0, 9, "a", [Utterance("a", 1, 5)])]


def test_the_kept_transcript_round_trips_and_bad_files_read_as_none(tmp_path):
    path = tmp_path / "transcript.json"
    chunks = [chunk(0, 40_000, utt("Hello there.", 1_000))]
    ac.save_transcript(path, chunks, [ac.Silence(0, 900)])
    assert ac.load_transcript(path) == (chunks, [ac.Silence(0, 900)])
    for bad in ("", "{}", '{"version": 2, "chunks": [], "silences": []}', '{"version": 1, "chunks": [{}], "silences": []}'):
        path.write_text(bad, encoding="utf-8")
        assert ac.load_transcript(path) is None
    assert ac.load_transcript(tmp_path / "missing.json") is None


def test_transcript_size_for_fifteen_fast_minutes_is_in_the_low_hundreds_of_kilobytes(tmp_path):
    """The size estimate in the plan: ~3,600 words (20 chars/s for 900 s) -> well under 300 KB of JSON."""
    sentence = "this speaker talks quickly about her day in the city."
    chunks = []
    for n in range(23):
        utts = [utt(sentence, 1_000 + i * 4_000) for i in range(9)]
        chunks.append(chunk(n * 39_000, n * 39_000 + 41_000, *utts))
    path = tmp_path / "transcript.json"
    ac.save_transcript(path, chunks, [])
    words = sum(len(u.words) for c in chunks for u in c.utterances)
    assert 1_900 <= words <= 2_100 and path.stat().st_size < 150_000
    assert path.stat().st_size / words < 70  # bytes per word, text included
```

- [ ] **Step 3:改既有测试。** `tests/test_library_asr_timed.py::test_state_keeps_utterances_and_still_reads_version_1`(Edit,两处):`assert ac.STATE_VERSION == 2 and ac.load_state(path) == chunks` → `assert ac.STATE_VERSION == 3 and ac.load_state(path) == chunks`;`path.write_text('{"version": 3, "chunks": []}', encoding="utf-8")` → `path.write_text('{"version": 4, "chunks": []}', encoding="utf-8")`。
- [ ] **Step 4:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_chunks_v3.py`(`TypeError: plan_chunks() got an unexpected keyword argument 'overlap_ms'` 等)。
- [ ] **Step 5:`app/library/limits.py`(Edit):** `ASR_HARD_CUT_MS = 40_000` 之后加一行 `ASR_HARD_CUT_OVERLAP_MS = 2_000  # plan v2 R-V5: both chunks hear ±1 s around a hard cut (word times only)`。
- [ ] **Step 6:`app/library/asr_chunks.py`(Edit,五处):**
  1. `from dataclasses import asdict, dataclass` → `from dataclasses import dataclass`;`from app.speech.timed import TimedText, Utterance` → `from app.speech.timed import TimedText, Utterance, Word`。
  2. 常量

```python
SNAP_WINDOW_MS = 800
STATE_VERSION = 2
READABLE_VERSIONS = (1, 2)  # version 1 chunks carry no utterances: still usable, nothing is paid for twice (R-A6)
```

  换成

```python
SNAP_WINDOW_MS = 800
STATE_VERSION = 3  # plan v2 R-V7: utterances carry their words ([text, start_ms, end_ms] lists)
READABLE_VERSIONS = (1, 2, 3)  # version 1 chunks carry no utterances, version 2 no words: still usable (R-A6, R-V7)
TRANSCRIPT_VERSION = 1  # the kept recognizer output of a ready item (plan v2 R-V8)
```

  3. 整个 `plan_chunks` 函数换成:

```python
def plan_chunks(duration_ms: int, silences: list[Silence], overlap_ms: int = 0) -> list[Chunk]:
    """Greedy from 0: the rest fits in 50 s -> one last chunk; else cut at the middle of the longest silence whose
    middle lies 15-50 s after the chunk start (ties: closest to 25 s); no silence there -> hard cut at 40 s.
    `overlap_ms` > 0 (plan v2 R-V5, only with word times): a hard cut is not a pause, so both chunks hear
    `overlap_ms` around it (the left one ends overlap/2 after the cut, the right one starts overlap/2 before it) and
    `timeline.merge_seams` keeps each word once. Silence cuts never overlap."""
    chunks: list[Chunk] = []
    start = 0
    half = max(0, overlap_ms) // 2
    while start < duration_ms:
        if duration_ms - start <= ASR_CHUNK_MAX_MS:
            chunks.append(Chunk(start, duration_ms))
            break
        lo, hi = start + ASR_CHUNK_MIN_MS, start + ASR_CHUNK_MAX_MS
        inside = [s for s in silences if lo <= s.mid_ms <= hi]
        if inside:
            best = max(inside, key=lambda s: (s.length_ms, -abs(s.mid_ms - (start + ASR_CHUNK_TARGET_MS))))
            cut = best.mid_ms
            chunks.append(Chunk(start, cut))
            start = cut
        else:
            cut = start + ASR_HARD_CUT_MS
            chunks.append(Chunk(start, min(duration_ms, cut + half)))
            start = cut - half
    return chunks
```

  4. 从 `def _load_utterances(raw)` 到 `save_state` 结束(`os.replace(tmp, path)` 那行)的整段换成:

```python
def _load_utterances(raw) -> list[Utterance] | None:
    if not isinstance(raw, list):
        return None
    return [Utterance(str(u["text"]), int(u["start_ms"]), int(u["end_ms"]),
                      tuple(Word(str(w[0]), int(w[1]), int(w[2])) for w in u.get("words") or ()))
            for u in raw]


def _utterance_json(u: Utterance) -> dict:
    out = {"text": u.text, "start_ms": u.start_ms, "end_ms": u.end_ms}
    if u.words:
        out["words"] = [[w.text, w.start_ms, w.end_ms] for w in u.words]
    return out


def _chunk_json(c: Chunk) -> dict:
    return {"start_ms": c.start_ms, "end_ms": c.end_ms, "text": c.text,
            "utterances": None if c.utterances is None else [_utterance_json(u) for u in c.utterances]}


def _chunks_from(raw) -> list[Chunk]:
    return [Chunk(int(c["start_ms"]), int(c["end_ms"]), c.get("text"), _load_utterances(c.get("utterances")))
            for c in raw]


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def load_state(path: Path) -> list[Chunk] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") not in READABLE_VERSIONS:
            return None
        return _chunks_from(data["chunks"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        return None


def save_state(path: Path, chunks: list[Chunk]) -> None:
    _write_json(path, {"version": STATE_VERSION, "chunks": [_chunk_json(c) for c in chunks]})


def save_transcript(path: Path, chunks: list[Chunk], silences: list[Silence]) -> None:
    """The recognizer's whole output for a ready item (plan v2 R-V8): every chunk with its text, utterances and words,
    plus the silence table. Kept in the item directory so sentences can be rebuilt without paying again; deleted with
    the item. Holds transcript text: never log it, never copy it elsewhere."""
    _write_json(path, {"version": TRANSCRIPT_VERSION, "chunks": [_chunk_json(c) for c in chunks],
                       "silences": [[x.start_ms, x.end_ms] for x in silences]})


def load_transcript(path: Path) -> tuple[list[Chunk], list[Silence]] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != TRANSCRIPT_VERSION:
            return None
        return _chunks_from(data["chunks"]), [Silence(int(a), int(b)) for a, b in data["silences"]]
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        return None
```

  (上面这段之后紧接着原来的 `def slice_wav(` 不变。)

- [ ] **Step 7:跑测试:** `cd server && uv run pytest -q tests/test_library_chunks_v3.py tests/test_library_asr_timed.py tests/test_library_asr_chunks.py tests/test_library_alignment.py tests/test_library_worker.py tests/test_architecture.py`。既有用例必须不改而绿:`plan_chunks` 默认不重叠;流水线此时还没传 `overlap_ms`。
- [ ] **Step 8:提交:**

```
feat(server): overlap hard-cut chunks, keep word times in chunks.json v3, save and load a transcript

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 3:词级时间线(`timeline.py`)

**Files:** Create `server/app/library/timeline.py`、`server/tests/test_library_timeline.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_timeline.py`:

```python
"""词级时间线(plan 2026-10-14-library-alignment-v2 R-V2…R-V6):词元对齐、回落、重叠接缝。"""
from app.library import asr_chunks as ac
from app.library import timeline as tl
from app.speech.timed import Utterance, Word
from tests.library_words import chunk, tok, utt


# ---- alignment of the sentence text to the recognizer's words ----

def test_every_token_takes_the_times_of_its_own_word():
    u = utt("Hello, world. How are you?", 1_000)
    assert tl.align_words(u.text.split(), u.words) == [(w.start_ms, w.end_ms) for w in u.words]


def test_split_and_joined_words_and_case_do_not_matter():
    words = [Word("well", 0, 200), Word("known", 220, 500), Word("FACT", 560, 900)]
    assert tl.align_words(["Well-known", "fact."], words) == [(0, 500), (560, 900)]


def test_tokens_the_recognizer_wrote_differently_stay_unmatched():
    words = [Word("it", 0, 100), Word("costs", 150, 500), Word("twenty", 550, 800), Word("five", 820, 1000),
             Word("dollars", 1050, 1500)]
    assert tl.align_words(["It", "costs", "$25", "now."], words)[:2] == [(0, 100), (150, 500)]
    assert tl.align_words(["It", "costs", "$25", "now."], words)[2:] == [None, None]


def test_unmatched_tokens_are_spread_between_their_known_neighbours():
    u = Utterance("It costs $25 dollars.", 0, 1500,
                  (Word("it", 0, 100), Word("costs", 150, 500), Word("twenty", 550, 800), Word("five", 820, 1000),
                   Word("dollars", 1050, 1500)))
    got = tl.utterance_tokens(u, 10_000, 40_000)
    assert [(t.text, t.kind) for t in got] == [("It", "word"), ("costs", "word"), ("$25", "interp"), ("dollars.", "word")]
    assert got[2].start_ms >= got[1].end_ms and got[2].end_ms <= got[3].start_ms
    assert (got[0].start_ms, got[-1].end_ms) == (10_000, 11_500)


def test_an_utterance_without_words_is_spread_over_its_own_span_like_v1():
    got = tl.utterance_tokens(Utterance("one two three", 2_000, 3_400), 0, 40_000)
    assert [t.kind for t in got] == ["interp"] * 3 and got[0].start_ms == 2_000 and got[-1].end_ms == 3_400


def test_words_that_mostly_do_not_match_are_not_believed():
    u = Utterance("alpha beta gamma delta", 0, 2000, (Word("zzz", 0, 500), Word("qqq", 600, 900)))
    assert [t.kind for t in tl.utterance_tokens(u, 0, 40_000)] == ["interp"] * 4


def test_word_times_are_clamped_into_the_audio_that_was_sent():
    u = utt("Hello there friend.", 39_500, word_ms=300)
    got = tl.utterance_tokens(u, 0, 40_000)
    assert got[-1].end_ms == 40_000 and all(t.end_ms <= 40_000 for t in got)


def test_untrusted_chunks_fall_back_to_the_speech_span_estimate():
    c = ac.Chunk(0, 10_000, "no times here at all")
    got = tl.chunk_tokens(c, [ac.Silence(0, 2_000)])
    assert {t.kind for t in got} == {"est"} and got[0].start_ms == 2_000 and got[-1].end_ms == 10_000


def test_has_words_needs_a_trusted_chunk_with_words():
    assert tl.has_words([chunk(0, 40_000, utt("Hello there my friend.", 18_000))])
    assert not tl.has_words([ac.Chunk(0, 40_000, "Hello there my friend.", [Utterance("Hello there my friend.", 0, 900)])])
    assert not tl.has_words([ac.Chunk(0, 40_000, "Hello there my friend.")])


# ---- seams between overlapping hard-cut chunks ----

LEFT_TEXT = "we walk along the river and then we stop"
RIGHT_TEXT = "and then we stop for a cup of tea today"


def seam_chunks(right_shift_ms: int = 0, right_text: str = RIGHT_TEXT):
    """A hard cut at 40 s with the 2 s overlap: the left chunk hears [0, 41 s), the right one [39 s, 80 s).
    'and then we stop' is spoken at 39.4-40.8 s and heard by both; the right side's times are jittered by
    `right_shift_ms` (two recognitions of the same audio never agree to the millisecond)."""
    left = utt(LEFT_TEXT, 37_600)  # word 5 ('and') starts at 37.6 + 5 x 0.36 = 39.4 s
    right = utt(right_text, 400 + right_shift_ms)  # relative to the right chunk's start (39 s)
    return [chunk(0, 41_000, left), chunk(39_000, 80_000, right)]


def texts(tokens):
    return " ".join(t.text for t in tokens)


def test_a_seam_keeps_every_word_once_and_is_not_flagged_when_both_sides_agree():
    chunks = seam_chunks()
    got = tl.tokens_for(chunks, [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"
    assert not any(t.seam for t in got)
    assert [t.start_ms for t in got] == sorted(t.start_ms for t in got)


def test_a_seam_survives_timing_jitter_between_the_two_recognitions():
    got = tl.tokens_for(seam_chunks(right_shift_ms=90), [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"


def test_two_recognitions_that_disagree_inside_the_overlap_are_flagged():
    got = tl.tokens_for(seam_chunks(right_text="hand den wee stomp for a cup of tea today"), [])
    assert any(t.seam for t in got)
    assert all(not t.seam for t in got if t.end_ms < 38_500 or t.start_ms > 41_500)


def test_a_side_without_word_times_is_deduplicated_by_text():
    left = chunk(0, 41_000, utt(LEFT_TEXT, 36_000))
    right = ac.Chunk(39_000, 80_000, "and then we stop for a cup of tea today")  # text-only fallback chunk
    got = tl.tokens_for([left, right], [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"
    assert {t.kind for t in got[9:]} == {"est"}


def test_text_overlap_needs_two_tokens():
    assert tl.text_overlap(["a", "b", "c."], ["B", "c", "d"]) == 2
    assert tl.text_overlap(["a", "b"], ["b", "x"]) == 0


def test_v1_overlaps_are_trimmed_by_text_and_lose_their_utterances():
    out = tl.trim_text_overlaps([ac.Chunk(0, 41_000, "we walk and then we stop"),
                                 ac.Chunk(39_000, 80_000, "and then we stop for tea", [])])
    assert out[1] == ac.Chunk(41_000, 80_000, "for tea", [])
    assert tl.trim_text_overlaps([ac.Chunk(0, 10, "a"), ac.Chunk(10, 20, "b")]) == [ac.Chunk(0, 10, "a"), ac.Chunk(10, 20, "b")]


def test_monotonic_never_lets_a_start_go_back():
    got = tl.monotonic([tok("a", 100, 300), tok("b", 90, 200), tok("c", 400, 350)])
    assert [(t.start_ms, t.end_ms) for t in got] == [(100, 300), (100, 200), (400, 400)]
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_timeline.py`(`ImportError: cannot import name 'timeline'`)。
- [ ] **Step 3:`app/library/timeline.py`(新):**

```python
"""词级时间线(plan 2026-10-14-library-alignment-v2 §设计 2、R-V2…R-V6;纯函数,只依赖标准库与本包)。

识别块 → 一串带绝对时间的「词元」(`Token`:识别句文字按空白切开的一段,带标点,例如 `world.`):
- 可信块(`asr_chunks.usable_utterances`)里的每个识别句:词元按字母对齐到识别服务给的 `words`(`align_words`)。对上的取词的
  起止(`kind="word"`);对不上的(数字规范化 `25` ↔ `twenty five`、符号)在左右最近的已知时间之间按字符数摊(`kind="interp"`);
  整句没有 `words`、或不到一半的词元对得上 → 全句在识别句的起止之间摊(`interp`,= v1 的真实时间路径)。
- 不可信 / 只有文字的块:在 `speech_span` 里按字符数摊(`kind="est"`,= v1 的估算)。
- 硬切的块两两重叠(`plan_chunks(..., overlap_ms)`):`merge_seams` 在重叠窗口里找一个离两边所有词元中点都最远的时刻 T,左块留
  中点 < T 的、右块留中点 >= T 的;两边文字对不上 → 窗口里留下的词元 `seam=True`。有一边没有词级时间时按文字去重。
"""
from collections.abc import Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from app.library.asr_chunks import Chunk, Silence, speech_span, usable_utterances
from app.speech.timed import Utterance, Word

WORD_SLACK_MS = 300  # a word may stick out of its utterance by this much (rounding)
MIN_WORD_MATCH = 0.5  # fewer tokens than this share matched to words -> the utterance's words are not believed
EDGE_GUARD_MS = 400  # words this close to the edge of the audio sent may be cut: the seam is not placed there
SEAM_AGREEMENT = 0.6  # SequenceMatcher ratio of the two sides' words inside the overlap window
MAX_TEXT_OVERLAP = 20  # tokens compared when de-duplicating a seam by text


@dataclass(frozen=True)
class Token:
    text: str
    start_ms: int
    end_ms: int
    kind: str  # "word" (the recognizer's word times) | "interp" (spread between known times) | "est" (v1 estimate)
    seam: bool = False  # near a hard-cut seam whose two recognitions disagreed

    @property
    def mid_ms(self) -> float:
        return (self.start_ms + self.end_ms) / 2


def norm(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def align_words(tokens: Sequence[str], words: Sequence[Word]) -> list[tuple[int, int] | None]:
    """For every text token the (start, end) of the recognizer word(s) it was matched to, or None.

    1. Tokens and words are compared as whole normalized words (letters and digits, lower case), in order
       (`SequenceMatcher` over the two lists): "Hello," matches "hello".
    2. Between two matched pairs, a run of tokens and a run of words whose letters are the same when joined
       ("well-known" vs "well" + "known", "can not" vs "cannot") are matched by letter position.
    3. Everything else stays None (number normalization "$25" vs "twenty five", symbols): the caller spreads it.
    A token whose start would go back in time becomes None, so the result is monotonic."""
    tn = [norm(t) or f"#t{i}" for i, t in enumerate(tokens)]
    wn = [norm(w.text) or f"#w{j}" for j, w in enumerate(words)]
    out: list[tuple[int, int] | None] = [None] * len(tokens)
    pairs: list[tuple[int, int, int, int]] = []  # (token from, token to, word from, word to) of equal runs
    i0 = j0 = 0
    for a, b, size in SequenceMatcher(None, tn, wn, autojunk=False).get_matching_blocks():
        pairs.append((i0, a, j0, b))  # the unmatched gap before this block
        for k in range(size):
            out[a + k] = (words[b + k].start_ms, words[b + k].end_ms)
        i0, j0 = a + size, b + size
    for t_from, t_to, w_from, w_to in pairs:
        if t_from == t_to or w_from == w_to or "".join(tn[t_from:t_to]) != "".join(wn[w_from:w_to]):
            continue
        bounds: list[tuple[int, int, int]] = []  # (letter from, letter to, word index)
        pos = 0
        for j in range(w_from, w_to):
            bounds.append((pos, pos + len(wn[j]), j))
            pos += len(wn[j])
        pos = 0
        for i in range(t_from, t_to):
            lo, hi = pos, pos + len(tn[i])
            hit = [j for a, b, j in bounds if a < hi and lo < b]
            out[i] = (min(words[j].start_ms for j in hit), max(words[j].end_ms for j in hit))
            pos = hi
    last_start = -1
    for i, span in enumerate(out):
        if span is None:
            continue
        if span[0] < last_start:
            out[i] = None
            continue
        last_start = span[0]
    return out


def spread(texts: Sequence[str], start_ms: int, end_ms: int, kind: str) -> list[Token]:
    """Tokens laid end to end over [start, end] in proportion to their length (one character per joining space): the
    first starts at `start`, the last ends at `end` (the v1 character-share estimate)."""
    total = sum(len(t) for t in texts) + max(0, len(texts) - 1)
    span = max(0, end_ms - start_ms)
    out: list[Token] = []
    pos = 0
    for text in texts:
        s = start_ms + round(span * pos / max(1, total))
        e = start_ms + round(span * (pos + len(text)) / max(1, total))
        out.append(Token(text, s, max(s, e), kind))
        pos += len(text) + 1
    return out


def _fill(texts: list[str], spans: list[tuple[int, int] | None], lo: int, hi: int) -> list[Token]:
    """Matched tokens keep their word times; every run of unmatched ones is spread between its neighbours' times."""
    out: list[Token | None] = [Token(t, sp[0], sp[1], "word") if sp else None for t, sp in zip(texts, spans)]
    i = 0
    while i < len(out):
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < len(out) and out[j] is None:
            j += 1
        left = out[i - 1].end_ms if i > 0 else lo
        right = out[j].start_ms if j < len(out) else hi
        out[i:j] = spread(texts[i:j], left, max(left, right), "interp")
        i = j
    return [t for t in out if t is not None]


def utterance_tokens(u: Utterance, offset: int, length: int) -> list[Token]:
    """One recognizer sentence -> tokens in absolute ms (`offset` = chunk start; times clamped into the audio sent)."""
    texts = u.text.split()
    if not texts:
        return []
    spans: list[tuple[int, int] | None] = [None] * len(texts)
    if u.words:
        spans = align_words(texts, u.words)
        lo, hi = u.start_ms - WORD_SLACK_MS, u.end_ms + WORD_SLACK_MS
        spans = [sp if sp is not None and lo <= sp[0] and sp[1] <= hi else None for sp in spans]
        if sum(1 for sp in spans if sp is not None) < MIN_WORD_MATCH * len(texts):
            spans = [None] * len(texts)
    tokens = _fill(texts, spans, u.start_ms, u.end_ms)

    def clamp(ms: int) -> int:
        return offset + max(0, min(length, ms))

    return [replace(t, start_ms=clamp(t.start_ms), end_ms=clamp(t.end_ms)) for t in tokens]


def chunk_tokens(chunk: Chunk, silences: list[Silence]) -> list[Token]:
    text = " ".join((chunk.text or "").split())
    if not text:
        return []
    length = chunk.end_ms - chunk.start_ms
    utts = usable_utterances(chunk)
    if utts:
        out: list[Token] = []
        for u in utts:
            if u.start_ms < length:
                out += utterance_tokens(u, chunk.start_ms, length)
        return out
    s0, s1 = speech_span(chunk, silences)
    return spread(text.split(), s0, s1, "est")


def has_words(chunks: Sequence[Chunk]) -> bool:
    """True when at least one trusted chunk carries word times: the word path (v2) applies; else v1 (R-V9)."""
    return any(u.words for c in chunks for u in usable_utterances(c))


def _seam_by_time(left: list[Token], right: list[Token], lo: int, hi: int) -> tuple[list[Token], list[Token]]:
    a = [t for t in left if t.mid_ms >= lo]
    b = [t for t in right if t.mid_ms <= hi]
    g_lo, g_hi = lo + EDGE_GUARD_MS, hi - EDGE_GUARD_MS
    if g_lo >= g_hi:
        g_lo, g_hi = lo, hi
    center = (lo + hi) / 2
    candidates = [g_lo, g_hi, center]
    for side in (a, b):
        candidates += [(x.end_ms + y.start_ms) / 2 for x, y in zip(side, side[1:])]
    candidates = [c for c in candidates if g_lo <= c <= g_hi]
    mids = [t.mid_ms for t in a + b]
    cut = max(candidates, key=lambda c: (min((abs(c - m) for m in mids), default=0.0), -abs(c - center)))
    kept_left = [t for t in left if t.mid_ms < cut]
    kept_right = [t for t in right if t.mid_ms >= cut]
    words_a = [norm(t.text) for t in a if g_lo <= t.mid_ms <= g_hi]
    words_b = [norm(t.text) for t in b if g_lo <= t.mid_ms <= g_hi]
    agree = (not words_a and not words_b) or (
        bool(words_a) and bool(words_b) and SequenceMatcher(None, words_a, words_b, autojunk=False).ratio() >= SEAM_AGREEMENT)
    if not agree:
        kept_left = [replace(t, seam=True) if t.mid_ms >= lo else t for t in kept_left]
        kept_right = [replace(t, seam=True) if t.mid_ms <= hi else t for t in kept_right]
    return kept_left, kept_right


def text_overlap(left: Sequence[str], right: Sequence[str]) -> int:
    """How many leading tokens of `right` repeat the trailing tokens of `left` (normalized; at least 2, else 0)."""
    a = [norm(t) for t in left[-MAX_TEXT_OVERLAP:]]
    b = [norm(t) for t in right[:MAX_TEXT_OVERLAP]]
    for k in range(min(len(a), len(b)), 1, -1):
        if a[-k:] == b[:k]:
            return k
    return 0


def _seam_by_text(left: list[Token], right: list[Token], lo: int, hi: int) -> tuple[list[Token], list[Token]]:
    k = text_overlap([t.text for t in left], [t.text for t in right])
    if k:
        return left, right[k:]
    left = [replace(t, seam=True) if t.mid_ms >= lo else t for t in left]
    right = [replace(t, seam=True) if t.mid_ms <= hi else t for t in right]
    return left, right


def merge_seams(chunks: Sequence[Chunk], per_chunk: Sequence[list[Token]]) -> list[Token]:
    out: list[Token] = []
    for k, tokens in enumerate(per_chunk):
        nxt = list(tokens)
        if k == 0 or not out or not nxt or chunks[k].start_ms >= chunks[k - 1].end_ms:
            out += nxt
            continue
        lo, hi = chunks[k].start_ms, chunks[k - 1].end_ms
        window = [t for t in out if t.mid_ms >= lo] + [t for t in nxt if t.mid_ms <= hi]
        if all(t.kind == "word" for t in window):
            out, nxt = _seam_by_time(out, nxt, lo, hi)
        else:
            out, nxt = _seam_by_text(out, nxt, lo, hi)
        out += nxt
    return out


def monotonic(tokens: Sequence[Token]) -> list[Token]:
    """Starts never go back; an end is never before its start (a later token may still start before an earlier one ends)."""
    out: list[Token] = []
    last = 0
    for t in tokens:
        s = max(t.start_ms, last)
        out.append(replace(t, start_ms=s, end_ms=max(t.end_ms, s)))
        last = s
    return out


def tokens_for(chunks: Sequence[Chunk], silences: list[Silence]) -> list[Token]:
    return monotonic(merge_seams(chunks, [chunk_tokens(c, silences) for c in chunks]))


def trim_text_overlaps(chunks: Sequence[Chunk]) -> list[Chunk]:
    """The v1 path for overlapping chunks that have no word times (R-V9): the right chunk starts where the left one ends
    and loses the leading words that repeat the left chunk's last words. Its utterances are dropped (they no longer
    match its text), so v1 estimates it."""
    out: list[Chunk] = []
    for c in chunks:
        if out and c.start_ms < out[-1].end_ms:
            prev = out[-1]
            words = (c.text or "").split()
            k = text_overlap((prev.text or "").split(), words)
            c = Chunk(prev.end_ms, c.end_ms, " ".join(words[k:]) if c.text is not None else None,
                      None if c.utterances is None else [])
        out.append(c)
    return out
```

- [ ] **Step 4:跑测试:** `cd server && uv run pytest -q tests/test_library_timeline.py tests/test_library_chunks_v3.py tests/test_architecture.py`。
- [ ] **Step 5:提交:**

```
feat(server): word timeline for library recognition (alignment, fallbacks, seams)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 4:词元 → 句子(`wordseg.py`)

**Files:** Create `server/app/library/wordseg.py`、`server/tests/test_library_wordseg.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_wordseg.py`:

```python
"""词元 → 句子(plan 2026-10-14-library-alignment-v2 R-V10/R-V11):句子从首词起、到末词止,长停顿断开,短句不跨长间隔合并,
边界余量只占间隔的一部分、从不重叠。"""
import pytest

from app.library import wordseg as ws
from tests.library_words import run, tok


def spans(found):
    return [(s.start_ms, s.end_ms, s.text) for s in found]


def test_sentences_start_at_their_first_word_and_end_at_their_last_word_plus_a_small_pad():
    tokens = run("Hello there my friend. How are you today?".split(), start_ms=27_360, gaps={3: 900})
    got = ws.sentences(tokens, 60_000)
    assert [s.text for s in got] == ["Hello there my friend.", "How are you today?"]
    assert got[0].start_ms == 27_360 - 40  # the 40 ms lead: the media start is far away
    assert got[0].end_ms == tokens[3].end_ms + 80
    assert got[1].start_ms == tokens[4].start_ms - 40 and got[1].end_ms == tokens[-1].end_ms + 80


def test_pads_never_take_more_than_forty_percent_of_a_gap_so_sentences_never_touch_words_of_others():
    tokens = run("One two three. Four five six.".split(), gaps={2: 100})
    got = ws.sentences(tokens, 10_000)
    assert got[0].end_ms == tokens[2].end_ms + 40 and got[1].start_ms == tokens[3].start_ms - 40
    assert got[0].end_ms <= got[1].start_ms


def test_a_long_pause_inside_a_sentence_splits_it():
    tokens = run("So we went to the market and then we bought some apples.".split(), gaps={5: 2_400})
    got = ws.sentences(tokens, 30_000)
    assert [s.text for s in got] == ["So we went to the market", "and then we bought some apples."]
    assert got[0].end_ms < tokens[6].start_ms and got[1].start_ms > tokens[5].end_ms


def test_a_shorter_pause_splits_only_after_a_comma():
    plain = run("So we went to the market and then we bought some apples.".split(), gaps={5: 1_200})
    assert len(ws.sentences(plain, 30_000)) == 1
    comma = run("So we went to the market, and then we bought some apples.".split(), gaps={5: 1_200})
    assert [s.text for s in ws.sentences(comma, 30_000)] == ["So we went to the market,", "and then we bought some apples."]


def test_a_pause_never_leaves_a_single_word_behind():
    tokens = run("Well, we went to the market today.".split(), gaps={0: 2_500})
    assert len(ws.sentences(tokens, 30_000)) == 1


def test_a_short_sentence_is_not_merged_across_music():
    """The suspected cause of the reported 13.6 s / 19 character sentence: 'Okay.' merged over a long gap."""
    tokens = run(["Okay."], start_ms=382_300) + run("Let us go to the beach now.".split(), start_ms=394_000)
    got = ws.sentences(tokens, 400_000)
    assert [s.text for s in got] == ["Okay.", "Let us go to the beach now."]
    assert got[0].end_ms - got[0].start_ms < 1_000


def test_a_short_sentence_joins_the_closer_neighbour_when_the_gap_is_small():
    tokens = run("I see. Yes. That is right.".split(), gaps={1: 900, 2: 200})
    assert [s.text for s in ws.sentences(tokens, 30_000)] == ["I see.", "Yes. That is right."]


def test_an_overlong_sentence_is_cut_at_its_largest_gap():
    words = [f"w{i}" for i in range(50)]
    tokens = run(words, gaps={20: 500, 30: 450})
    got = ws.sentences(tokens, 60_000)
    assert [len(s.text.split()) for s in got] == [21, 29]


def test_an_overlong_sentence_prefers_a_comma_when_gaps_are_equal():
    words = [f"w{i}" for i in range(50)]
    words[34] = "w34,"
    got = ws.sentences(run(words), 60_000)
    assert got[0].text.endswith("w34,")


def test_the_text_comes_from_the_shared_splitter_and_tokens_without_letters_stay_with_the_previous_sentence():
    tokens = run(["Hello", "there.", "42!", "Yes."], gaps={2: 900})  # the splitter drops the letterless "42!"
    assert [s.text for s in ws.sentences(tokens, 30_000)] == ["Hello there. 42!", "Yes."]
    assert [s.text for s in ws.sentences(run(["Mr.", "Smith", "came", "in."]), 30_000)] == ["Mr. Smith came in."]


def test_a_sentence_has_at_least_200_ms_but_never_runs_into_the_next_word():
    tokens = [tok("Hi.", 1_000, 1_000, "interp"), tok("Okay", 1_100, 1_400), tok("then", 1_450, 1_700),
              tok("we", 1_750, 1_900), tok("go.", 1_950, 2_300)]
    got = ws.sentences(tokens, 10_000)
    assert got[0].end_ms > got[0].start_ms


def test_the_last_sentence_never_ends_after_the_media():
    tokens = run("The very last words.".split(), start_ms=9_000, word_ms=200)
    got = ws.sentences(tokens, tokens[-1].end_ms + 10)
    assert got[-1].end_ms == tokens[-1].end_ms + 4


@pytest.mark.parametrize("text_pieces, expected", [
    (["Hello", "there."], [(0, 1)]),
    (["Hi.", "Bye."], [(0, 0), (1, 1)]),
    ([], []),
])
def test_text_pieces(text_pieces, expected):
    got = ws.text_pieces(run(text_pieces)) if text_pieces else ws.text_pieces([])
    assert [(p.first, p.last) for p in got] == expected
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_wordseg.py`。
- [ ] **Step 3:`app/library/wordseg.py`(新):**

```python
"""词元 → 句子(plan 2026-10-14-library-alignment-v2 §设计 3、R-V10/R-V11;纯函数)。

1. 句子文字仍由 `app.speech.sentence_split.split_all` 决定(不改它,与网页切句同一规则):词元按一个空格连接,每个句子从它首字符
   所在的词元开始(切点落在词元中间时,这个词元归前一句)。没有字母、被切句器丢掉的词元跟着前一句。
2. 句内长停顿断开:相邻两个有时间的词元间隔 >= 2 s,或 >= 1 s 且前一个词元以 `, ; : -` 结尾,两边各 >= 2 个词才断。
3. 超长(> 14 s 或 > 40 词)的句子在「最大的间隔」处断(同档时优先逗号等后面、再靠近中点),递归。
4. 短句(< 1 s 或 < 3 词)并到间隔更小的一侧,但间隔 > 700 ms 就不并(短句本身是合法的一句,不能跨音乐 / 长停顿拉长)。
5. 起止 = 首词起点 / 末词终点,再各加一点余量(前 40 ms、后 80 ms),每侧最多占到与相邻词间隔的 40%,所以句与句不重叠、
   也不伸进别人的词;每句至少 200 ms(网页微调的最小长度)但不越过下一个词;最后一句不超过素材长度。
"""
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from app.library.limits import SEGMENT_TEXT_MAX
from app.library.timeline import Token
from app.speech.sentence_split import split_all

MAX_MS = 14_000
MAX_WORDS = 40
MIN_MS = 1_000
MIN_WORDS = 3
HARD_PAUSE_MS = 2_000
SOFT_PAUSE_MS = 1_000
MIN_SPLIT_WORDS = 2
MERGE_GAP_MS = 700
PREFERRED_GAP_MS = 400
LEAD_PAD_MS = 40
TAIL_PAD_MS = 80
PAD_GAP_SHARE = 0.4
MIN_SPAN_MS = 200
CLAUSE_END = (",", ";", ":", "-", "–", "—")


@dataclass(frozen=True)
class Piece:
    first: int
    last: int  # inclusive


@dataclass(frozen=True)
class WordSentence:
    start_ms: int
    end_ms: int
    text: str
    first: int  # token range [first, last]
    last: int


def gap_after(tokens: Sequence[Token], k: int) -> int:
    """Silence between token k and token k + 1 (0 when they touch or overlap, or when k is the last)."""
    if k + 1 >= len(tokens):
        return 0
    return max(0, tokens[k + 1].start_ms - tokens[k].end_ms)


def _text(tokens: Sequence[Token], p: Piece) -> str:
    return " ".join(t.text for t in tokens[p.first:p.last + 1])


def _duration(tokens: Sequence[Token], p: Piece) -> int:
    return tokens[p.last].end_ms - tokens[p.first].start_ms


def _words(p: Piece) -> int:
    return p.last - p.first + 1


def text_pieces(tokens: Sequence[Token]) -> list[Piece]:
    if not tokens:
        return []
    starts: list[int] = []
    pos = 0
    for t in tokens:
        starts.append(pos)
        pos += len(t.text) + 1
    joined = " ".join(t.text for t in tokens)
    firsts = {0}
    cursor = 0
    for sentence in split_all(joined):
        at = joined.find(sentence, cursor)
        if at < 0:
            continue
        cursor = at + len(sentence)
        k = bisect_right(starts, at) - 1
        if starts[k] < at:  # the sentence starts inside a token: that token stays with the previous sentence
            k += 1
        if k < len(tokens):
            firsts.add(k)
    edges = sorted(firsts)
    return [Piece(a, b - 1) for a, b in zip(edges, edges[1:] + [len(tokens)])]


def _pause_cut(tokens: Sequence[Token], p: Piece) -> int | None:
    best: tuple[int, int] | None = None
    for k in range(p.first + MIN_SPLIT_WORDS - 1, p.last - MIN_SPLIT_WORDS + 1):
        if tokens[k].kind == "est" or tokens[k + 1].kind == "est":
            continue
        gap = gap_after(tokens, k)
        if gap >= HARD_PAUSE_MS or (gap >= SOFT_PAUSE_MS and tokens[k].text.endswith(CLAUSE_END)):
            if best is None or gap > best[0]:
                best = (gap, k)
    return None if best is None else best[1]


def split_pauses(tokens: Sequence[Token], p: Piece) -> list[Piece]:
    k = _pause_cut(tokens, p)
    if k is None:
        return [p]
    return split_pauses(tokens, Piece(p.first, k)) + split_pauses(tokens, Piece(k + 1, p.last))


def _too_long(tokens: Sequence[Token], p: Piece) -> bool:
    return _duration(tokens, p) > MAX_MS or _words(p) > MAX_WORDS


def split_long(tokens: Sequence[Token], p: Piece) -> list[Piece]:
    if not _too_long(tokens, p) or p.first == p.last:
        return [p]
    middle = (tokens[p.first].start_ms + tokens[p.last].end_ms) / 2
    lo, hi = p.first, p.last - 1
    if _words(p) >= 2 * MIN_SPLIT_WORDS:
        lo, hi = p.first + MIN_SPLIT_WORDS - 1, p.last - MIN_SPLIT_WORDS

    def score(k: int):
        gap = gap_after(tokens, k)
        return (gap >= PREFERRED_GAP_MS, tokens[k].text.endswith(CLAUSE_END + (".", "!", "?")), gap,
                -abs(tokens[k].end_ms - middle))

    k = max(range(lo, hi + 1), key=score)
    return split_long(tokens, Piece(p.first, k)) + split_long(tokens, Piece(k + 1, p.last))


def _short(tokens: Sequence[Token], p: Piece) -> bool:
    return _duration(tokens, p) < MIN_MS or _words(p) < MIN_WORDS


def _fits(tokens: Sequence[Token], p: Piece) -> bool:
    return not _too_long(tokens, p) and len(_text(tokens, p)) <= SEGMENT_TEXT_MAX


def merge_short(tokens: Sequence[Token], pieces: list[Piece]) -> list[Piece]:
    out = list(pieces)
    i = 0
    while i < len(out):
        p = out[i]
        if not _short(tokens, p):
            i += 1
            continue
        options = []
        if i > 0:
            options.append((gap_after(tokens, out[i - 1].last), i - 1))
        if i + 1 < len(out):
            options.append((gap_after(tokens, p.last), i))
        merged = False
        for gap, left in sorted(options):
            joined = Piece(out[left].first, out[left + 1].last)
            if gap <= MERGE_GAP_MS and _fits(tokens, joined):
                out[left:left + 2] = [joined]
                i = left
                merged = True
                break
        if not merged:
            i += 1
    return out


def sentences(tokens: Sequence[Token], limit_ms: int) -> list[WordSentence]:
    """Tokens (monotonic starts, see `timeline.monotonic`) -> sentences with padded, non-overlapping times."""
    pieces: list[Piece] = []
    for p in text_pieces(tokens):
        for q in split_pauses(tokens, p):
            pieces += split_long(tokens, q)
    pieces = merge_short(tokens, pieces)
    out: list[WordSentence] = []
    previous_end = 0
    for p in pieces:
        text = " ".join(_text(tokens, p).split())
        if not text:
            continue
        s, e = tokens[p.first].start_ms, tokens[p.last].end_ms
        before = s - tokens[p.first - 1].end_ms if p.first > 0 else s
        after = tokens[p.last + 1].start_ms - e if p.last + 1 < len(tokens) else max(0, limit_ms - e)
        start = max(previous_end, s - min(LEAD_PAD_MS, int(max(0, before) * PAD_GAP_SHARE)))
        end = e + min(TAIL_PAD_MS, int(max(0, after) * PAD_GAP_SHARE))
        if end - start < MIN_SPAN_MS:
            ceiling = tokens[p.last + 1].start_ms if p.last + 1 < len(tokens) else limit_ms
            end = max(end, min(start + MIN_SPAN_MS, ceiling))
        end = min(end, limit_ms) if limit_ms > start else end
        end = max(end, start + 1)
        out.append(WordSentence(start, end, text, p.first, p.last))
        previous_end = end
    return out
```

- [ ] **Step 4:跑测试:** `cd server && uv run pytest -q tests/test_library_wordseg.py tests/test_library_timeline.py tests/test_architecture.py`。
- [ ] **Step 5:提交:**

```
feat(server): cut library sentences on word times (pauses, merges, bounded pads)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 5:v2 合理性检查 + 总入口(`quality.py`、`sentences.py`)

**Files:** Modify `server/app/library/quality.py`;Create `server/app/library/sentences.py`、`server/tests/test_library_quality_v2.py`、`server/tests/test_library_sentences.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_quality_v2.py`:

```python
"""v2 合理性检查(plan 2026-10-14-library-alignment-v2 R-V13/R-V14):按这条素材自己的语速分布判断,每句给标记,
只有相当一部分句子可疑时条目才算 low_confidence。用户那条素材:中位 20 字符/秒、p90 25.1、最快 30.3 —— 快,但不是错。"""
import math

import pytest

from app.library import quality as q
from app.library import wordseg as ws
from tests.library_words import run, tok


def sentences_at(rates_cps: list[float], chars: int = 40) -> tuple[list, list]:
    """One sentence of 5 equal words per rate (`chars` // 5 - 1 letters each), its words spread evenly so the sentence
    has exactly that articulation rate; sentences 1.5 s apart."""
    tokens, found, t = [], [], 0
    for rate in rates_cps:
        text = ("x" * (chars // 5 - 1) + " ") * 5
        words = text.split()
        span = round(len(" ".join(words)) / rate * 1000)
        step = span // len(words)
        first = len(tokens)
        for i, w in enumerate(words):
            tokens.append(tok(w, t + i * step, t + (i + 1) * step))
        found.append(ws.WordSentence(t, t + step * len(words), " ".join(words), first, len(tokens) - 1))
        t += step * len(words) + 1_500
    return tokens, found


def test_robust_z_is_zero_at_the_median_and_floors_the_mad():
    assert q.robust_z([]) == []
    assert q.robust_z([1.0, 1.0, 1.0])[0] == 0.0
    assert q.robust_z([0.0, 0.0, 1.0])[2] == pytest.approx(0.6745 / q.MAD_FLOOR)


def test_a_fast_speaker_is_not_flagged_for_being_fast():
    """The user's numbers: median 20, p90 25.1, max 30.3 chars/s; v1 flagged all 12 sentences above 25."""
    rates = [16, 17, 18, 19, 19.5, 20, 20, 20, 20.5, 21, 22, 23, 24, 25.1, 26, 27, 28, 30.3]
    tokens, found = sentences_at(rates)
    flags = q.sentence_flags(tokens, found)
    assert not any(q.FLAG_RATE in f for f in flags)
    assert q.item_low_confidence(flags) is False


def test_a_sentence_stretched_over_a_gap_is_flagged_against_the_speakers_own_median():
    rates = [20] * 12 + [3.2]  # the reported 19 characters over 13.6 s is ~1.4; 3.2 is already far off for this speaker
    tokens, found = sentences_at(rates)
    flags = q.sentence_flags(tokens, found)
    assert q.FLAG_RATE in flags[-1] and not any(flags[:-1])


def test_few_sentences_fall_back_to_absurd_bounds_only():
    tokens, found = sentences_at([20, 33, 4.0])
    assert [q.FLAG_RATE in f for f in q.sentence_flags(tokens, found)] == [False, False, True]


def test_articulation_rate_ignores_pauses():
    tokens = run(["abcd", "efgh", "ijkl"], gaps={0: 2_000})
    assert q.articulation_cps(tokens, 0, 2) == pytest.approx(14 / ((tokens[2].end_ms - tokens[0].start_ms - 2_000) / 1000))


def test_pause_estimated_seam_and_timing_flags():
    tokens = (run(["one", "two", "three", "four."], gaps={1: 1_800})
              + [tok("five", 5_000, 5_300, "est"), tok("six", 5_400, 5_700, "est"), tok("seven.", 5_800, 6_100, "est")]
              + [tok("eight", 7_000, 7_300, seam=True), tok("nine", 7_350, 7_600), tok("ten.", 7_650, 7_900)]
              + [tok("x", 9_000, 9_000), tok("y", 9_100, 9_100, "interp"), tok("zed.", 9_200, 9_500)])
    found = [ws.WordSentence(0, 0, "a", 0, 3), ws.WordSentence(0, 0, "b", 4, 6), ws.WordSentence(0, 0, "c", 7, 9),
             ws.WordSentence(0, 0, "d", 10, 12)]
    flags = q.sentence_flags(tokens, found)
    assert q.FLAG_PAUSE in flags[0] and q.FLAG_ESTIMATED in flags[1] and q.FLAG_SEAM in flags[2]
    assert q.FLAG_TIMING in flags[3]  # 2 of 3 words have no length or no time of their own


def test_word_duration_outliers_are_judged_per_item():
    tokens = run([f"word{i}" for i in range(30)], word_ms=300)
    tokens[10] = tok("word10", tokens[10].start_ms, tokens[10].start_ms + 6_000)
    assert q.suspect_tokens(tokens)[10] is True and sum(q.suspect_tokens(tokens)) == 1


def test_the_item_is_low_confidence_only_when_a_sizeable_share_is_flagged():
    assert q.item_low_confidence([()] * 9 + [("rate",)]) is False
    assert q.item_low_confidence([()] * 8 + [("rate",), ("pause",)]) is True
    assert q.item_low_confidence([]) is False


def test_flags_come_in_a_fixed_order_and_fit_the_column():
    assert len(",".join(q.FLAG_ORDER)) <= 48
    assert math.isclose(q.ITEM_FLAG_SHARE, 0.15)
```

  和 `server/tests/test_library_sentences.py`:

```python
"""识别结果 → 句子的总入口(plan 2026-10-14-library-alignment-v2 R-V9):有词级时间走词路径,没有就是 v1 原样。
「vlog」夹具复现用户那条素材的形状:开头 27 s 背景音乐、语速快、句中长停顿、音乐间隙两边的短句、40 s 硬切切在一个词中间。"""
from app.library import asr_chunks as ac
from app.library import segment, sentences
from app.speech.timed import Utterance
from tests.library_words import chunk, utt

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]


def test_without_word_times_the_v1_path_is_used_unchanged():
    utts = [Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100)]
    chunks = [ac.Chunk(0, 40_000, " ".join(LINES), utts)]
    built = sentences.build(chunks, [])
    v1 = segment.build(ac.fragments(chunks, []), adjust=ac.snapper([]))
    assert built.algorithm == sentences.V1 and built.sentences == v1 and built.flags == [(), (), ()]
    assert built.low_confidence is False


def test_text_only_overlapping_chunks_are_deduplicated_on_the_v1_path():
    chunks = [ac.Chunk(0, 41_000, "We walk along the river and then we stop."),
              ac.Chunk(39_000, 80_000, "and then we stop. For a cup of tea today.")]
    built = sentences.build(chunks, [])
    assert built.algorithm == sentences.V1
    assert " ".join(s.text for s in built.sentences).count("and then we stop") == 1


def vlog() -> list[ac.Chunk]:
    """0-27 s music only. Speech from 27.36 s, fast (word 250 ms, gap 40 ms). Hard cut at 40 s inside 'understand';
    a 3.1 s pause inside a sentence; 'Okay.' at 60 s then 10 s of music then a new sentence; 2 s overlap."""
    a1 = utt("Hi everyone and welcome back to my channel.", 27_360, word_ms=250, gap_ms=40)
    a2 = utt("Today I want to show you how I understand the city", 37_100, word_ms=250, gap_ms=40)
    b2 = utt("I understand the city and why I love it.", 39_130 - 39_000, word_ms=250, gap_ms=40)
    b3 = utt("So we went to the market and then, honestly, we bought way too much food.", 43_000 - 39_000,
             word_ms=250, gap_ms=40, gaps={5: 3_100})
    b4 = utt("Okay.", 60_000 - 39_000, word_ms=300)
    c1 = utt("Let us go to the beach now.", 71_000 - 39_000, word_ms=250, gap_ms=40)
    return [chunk(0, 41_000, a1, a2), chunk(39_000, 80_000, b2, b3, b4, c1)]


def test_the_vlog_shape_gets_word_accurate_boundaries():
    built = sentences.build(vlog(), [])
    assert built.algorithm == sentences.WORDS
    texts = [s.text for s in built.sentences]
    assert texts[0] == "Hi everyone and welcome back to my channel."
    assert built.sentences[0].start_ms == 27_360 - 40  # the first word, not the music before it
    assert sum(t.count("understand") for t in texts) == 1  # the straddled word is kept once
    assert "So we went to the market" in texts  # split at the 3.1 s pause
    assert "Okay." in texts and texts[texts.index("Okay.") + 1] == "Let us go to the beach now."
    okay = built.sentences[texts.index("Okay.")]
    assert okay.end_ms - okay.start_ms < 1_000  # not stretched over the music
    assert all(a.end_ms <= b.start_ms for a, b in zip(built.sentences, built.sentences[1:]))
    assert all(s.end_ms > s.start_ms for s in built.sentences)


def test_the_vlog_shape_is_not_low_confidence_and_flags_line_up():
    built = sentences.build(vlog(), [])
    assert len(built.flags) == len(built.sentences)
    assert built.low_confidence is False


def test_build_is_deterministic():
    assert sentences.build(vlog(), []) == sentences.build(vlog(), [])
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_quality_v2.py tests/test_library_sentences.py`。
- [ ] **Step 3:`app/library/quality.py`(Edit):** 导入段

```python
from collections.abc import Sequence

from app.library.asr_chunks import Chunk, Silence, estimated_chunks, speech_span
from app.library.segment import Sentence
```

  换成

```python
import math
from collections.abc import Sequence

from app.library.asr_chunks import Chunk, Silence, estimated_chunks, speech_span
from app.library.segment import Sentence
from app.library.timeline import Token, norm
from app.library.wordseg import WordSentence, gap_after
```

  文件末尾(`is_low_confidence` 之后)追加:

```python
# ---- v2: per-sentence flags from word times, judged against the item's own distribution (plan v2 R-V13/R-V14) ----

FLAG_RATE = "rate"  # articulation rate far from this speaker's own median (robust z)
FLAG_PAUSE = "pause"  # a pause > 1.5 s is still inside the sentence
FLAG_TIMING = "timing"  # >= 30 % of its words have untrustworthy times (unmatched, zero-length, duration outliers)
FLAG_ESTIMATED = "estimated"  # some words have no recognizer time at all (v1 estimate)
FLAG_SEAM = "seam"  # touches a hard-cut seam where the two recognitions disagreed
FLAG_ORDER = (FLAG_RATE, FLAG_PAUSE, FLAG_TIMING, FLAG_ESTIMATED, FLAG_SEAM)
ROBUST_Z = 3.5
MAD_FLOOR = 0.05  # natural-log units: a perfectly even speaker must not turn every small wobble into an outlier
MIN_RATE_CHARS = 12
MIN_RATE_SAMPLES = 8
FALLBACK_CPS = (5.0, 35.0)  # too few sentences for a distribution: only absurd rates are flagged
ARTICULATION_GAP_MS = 300  # gaps longer than this are pauses, not speech, when measuring the rate
PAUSE_FLAG_MS = 1_500
MIN_WORD_SAMPLES = 20
SUSPECT_SHARE = 0.3
ITEM_FLAG_SHARE = 0.15  # the item is low confidence when at least this share of its sentences is flagged


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    return ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2


def robust_z(values: list[float]) -> list[float]:
    """0.6745 * (x - median) / MAD, with the MAD floored at `MAD_FLOOR` ([] for no values)."""
    if not values:
        return []
    med = _median(values)
    mad = max(_median([abs(v - med) for v in values]), MAD_FLOOR)
    return [0.6745 * (v - med) / mad for v in values]


def articulation_cps(tokens: Sequence[Token], first: int, last: int) -> float | None:
    """Characters (spaces included) per second of speech: the span minus every inner gap > 300 ms."""
    span = tokens[last].end_ms - tokens[first].start_ms
    pauses = sum(g for g in (gap_after(tokens, k) for k in range(first, last)) if g > ARTICULATION_GAP_MS)
    speech = span - pauses
    if speech <= 0:
        return None
    chars = len(" ".join(t.text for t in tokens[first:last + 1]))
    return chars / (speech / 1000)


def suspect_tokens(tokens: Sequence[Token]) -> list[bool]:
    """Per token: is its time untrustworthy? `interp` always; a `word` when it has no length or (with >= 20 words of
    two or more letters) its milliseconds per letter is a robust outlier of this item; `est` is judged separately."""
    suspect = [t.kind == "interp" or (t.kind == "word" and t.end_ms <= t.start_ms) for t in tokens]
    sample = [(i, math.log((t.end_ms - t.start_ms) / len(norm(t.text)))) for i, t in enumerate(tokens)
              if t.kind == "word" and t.end_ms > t.start_ms and len(norm(t.text)) >= 2]
    if len(sample) >= MIN_WORD_SAMPLES:
        for (i, _v), z in zip(sample, robust_z([v for _i, v in sample])):
            if abs(z) > ROBUST_Z:
                suspect[i] = True
    return suspect


def sentence_flags(tokens: Sequence[Token], sentences: Sequence[WordSentence]) -> list[tuple[str, ...]]:
    """`sentences` are `wordseg.sentences(tokens, ...)`. Returns the flags of each, in `FLAG_ORDER`."""
    flags: list[set[str]] = [set() for _ in sentences]
    suspect = suspect_tokens(tokens)
    rates: list[tuple[int, float]] = []
    for n, s in enumerate(sentences):
        part = tokens[s.first:s.last + 1]
        if any(t.kind == "est" for t in part):
            flags[n].add(FLAG_ESTIMATED)
        if any(t.seam for t in part):
            flags[n].add(FLAG_SEAM)
        if max((gap_after(tokens, k) for k in range(s.first, s.last)), default=0) > PAUSE_FLAG_MS:
            flags[n].add(FLAG_PAUSE)
        if sum(suspect[s.first:s.last + 1]) >= SUSPECT_SHARE * len(part):
            flags[n].add(FLAG_TIMING)
        if FLAG_ESTIMATED not in flags[n] and len(s.text) >= MIN_RATE_CHARS:
            cps = articulation_cps(tokens, s.first, s.last)
            if cps is None:
                flags[n].add(FLAG_RATE)
            else:
                rates.append((n, cps))
    if len(rates) >= MIN_RATE_SAMPLES:
        for (n, _cps), z in zip(rates, robust_z([math.log(c) for _n, c in rates])):
            if abs(z) > ROBUST_Z:
                flags[n].add(FLAG_RATE)
    else:
        for n, cps in rates:
            if not FALLBACK_CPS[0] <= cps <= FALLBACK_CPS[1]:
                flags[n].add(FLAG_RATE)
    return [tuple(f for f in FLAG_ORDER if f in got) for got in flags]


def item_low_confidence(flags: Sequence[tuple[str, ...]]) -> bool:
    return bool(flags) and sum(1 for f in flags if f) / len(flags) >= ITEM_FLAG_SHARE
```

  并在模块文档字符串末尾(「有可信真实时间的块不看说话占比:背景音乐 + 少量人声是合法的。」之后、`"""` 之前)加一行:

```text
v2(plan 2026-10-14-library-alignment-v2):有词级时间时改用 `sentence_flags` + `item_low_confidence`(按这条素材自己的分布判断,每句给标记);上面两条只用于 v1 路径。
```

- [ ] **Step 4:`app/library/sentences.py`(新):**

```python
"""识别结果 → 句子 + 每句标记 + 条目的 `low_confidence`(plan 2026-10-14-library-alignment-v2 R-V9;纯函数)。

流水线(首次识别、重新识别)与「重建句子」(`POST /items/{id}/rebuild`,不再花识别钱)共用这一个入口,所以算法改进只要重建就生效。
- 至少一个可信块带词级时间 → 词路径(`timeline` → `wordseg` → `quality.sentence_flags`);
- 否则 → v1 原样(`segment.build` + 静音吸附 + `quality.is_low_confidence`;重叠的块先按文字去重),每句没有标记。
"""
from collections.abc import Sequence
from dataclasses import dataclass

from app.library import asr_chunks, quality, segment, timeline, wordseg
from app.library.asr_chunks import Chunk, Silence

WORDS = "words"
V1 = "v1"


@dataclass(frozen=True)
class Built:
    sentences: list[segment.Sentence]
    flags: list[tuple[str, ...]]  # one entry per sentence (empty tuples on the v1 path)
    low_confidence: bool
    algorithm: str  # WORDS | V1 (logged as a constant, never with text)


def build(chunks: Sequence[Chunk], silences: list[Silence]) -> Built:
    chunks = list(chunks)
    if timeline.has_words(chunks):
        tokens = timeline.tokens_for(chunks, silences)
        limit = max((c.end_ms for c in chunks), default=0)
        found = wordseg.sentences(tokens, limit)
        flags = quality.sentence_flags(tokens, found)
        out = [segment.Sentence(s.start_ms, s.end_ms, s.text) for s in found]
        return Built(out, flags, quality.item_low_confidence(flags), WORDS)
    return build_v1(chunks, silences)


def build_v1(chunks: Sequence[Chunk], silences: list[Silence]) -> Built:
    """The v1 algorithm, unchanged (also used by `scripts/library_alignment_eval.py` to compare on the same transcript)."""
    plain = timeline.trim_text_overlaps(list(chunks))
    found = segment.build(asr_chunks.fragments(plain, silences), adjust=asr_chunks.snapper(silences))
    return Built(found, [() for _ in found], quality.is_low_confidence(found, plain, silences), V1)
```

- [ ] **Step 5:跑测试:** `cd server && uv run pytest -q tests/test_library_quality_v2.py tests/test_library_sentences.py tests/test_library_quality.py tests/test_library_wordseg.py tests/test_architecture.py`(`test_library_quality.py` 的 v1 用例必须不改而绿)。
- [ ] **Step 6:提交:**

```
feat(server): speaker-adaptive per-sentence timing flags and one entry point for library sentences

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 6:迁移 `0020` + 模型 + `store`

**Files:** Create `server/alembic/versions/0020_library_word_alignment.py`;Modify `server/app/models.py`、`server/app/library/store.py`、`server/tests/test_library_models.py`、`server/tests/test_migrations.py`、`server/tests/test_library_store.py`、`server/tests/test_library_media_api.py`。

- [ ] **Step 1:改测试(先红)。**
  1. `tests/test_migrations.py`:把全部 5 处 `get_heads() == ["0019"]` 换成 `get_heads() == ["0020"]`(Edit 的 `replace_all`)。
  2. `tests/test_library_models.py`:

```python
def test_head_is_0019_and_the_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0019"]
    assert script.get_revision("0019").down_revision == "0018"
```

  换成

```python
def test_head_is_0020_and_the_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0020"]
    assert script.get_revision("0020").down_revision == "0019"
    assert script.get_revision("0019").down_revision == "0018"
```

  并在 `def test_0018_creates_the_tables_with_their_keys_and_round_trips(` 之前插入:

```python
def test_0020_adds_flags_and_rebuildable_keeps_rows_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0019")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values ('i1', 12345678, 'video', 'upload', 't', 'ready', '2026-10-14', '2026-10-14')")
    con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) values ('i1', 0, 0, 900, 'Hi.')")
    con.commit()
    con.close()
    command.upgrade(cfg, "0020")
    con = sqlite3.connect(db)
    assert con.execute("select rebuildable from library_items where id = 'i1'").fetchone() == (0,)
    assert con.execute("select flags from library_segments where item_id = 'i1'").fetchone() == (None,)
    con.close()
    command.downgrade(cfg, "0019")
    con = sqlite3.connect(db)
    assert "rebuildable" not in {r[1] for r in con.execute("pragma table_info(library_items)")}
    assert "flags" not in {r[1] for r in con.execute("pragma table_info(library_segments)")}
    assert con.execute("select count(*) from library_segments").fetchone() == (1,)
    seg_pk = [r[1] for r in sorted(con.execute("pragma table_info(library_segments)"), key=lambda r: r[5]) if r[5]]
    assert seg_pk == ["item_id", "idx"]
    con.close()
    command.upgrade(cfg, "head")


```

  3. `tests/test_library_store.py::test_segments_attempts_and_explicit_delete`:三个 `segment_out` 期望字典各加 `"flags": []`——前两个(列表里的)把 `"has_analysis": False, "analysis_lang": None}` 换成 `"has_analysis": False, "analysis_lang": None, "flags": []}`(文件里恰好这两处,用 `replace_all`),第三个把 `"analysis_lang": "zh-CN"}  # the analysis text itself is not listed` 换成 `"analysis_lang": "zh-CN", "flags": []}  # the analysis text itself is not listed`。`test_item_out_shape_and_upload_progress`:`assert out["low_confidence"] is False` → `assert out["low_confidence"] is False and out["rebuildable"] is False`;键集合末尾 `"created_at", "last_opened_at", "low_confidence"}` → `"created_at", "last_opened_at", "low_confidence", "rebuildable"}`。
  4. `tests/test_library_media_api.py::test_segment_fine_tuning`:

```python
                                    "zh": None, "zh_lang": None, "has_analysis": False, "analysis_lang": None}}
```

  换成

```python
                                    "zh": None, "zh_lang": None, "has_analysis": False, "analysis_lang": None,
                                    "flags": []}}
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_models.py tests/test_migrations.py tests/test_library_store.py tests/test_library_media_api.py`。
- [ ] **Step 3:迁移** `server/alembic/versions/0020_library_word_alignment.py`:

```python
"""library: per-sentence timing flags and the rebuildable mark (plan 2026-10-14-library-alignment-v2 R-V14, R-V8)

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-14 12:00:00.000000

Two plain ADD COLUMNs (no table rewrite on Postgres 11+, no batch needed on SQLite for adding):
library_segments.flags VARCHAR(48) NULL (comma-separated codes such as "rate,pause"; NULL = nothing suspicious) and
library_items.rebuildable BOOLEAN NOT NULL DEFAULT false (the recognizer output is kept, so sentences can be rebuilt
without paying again). Existing rows read NULL / false. The downgrade uses batch mode for SQLite (like 0019).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0020'
down_revision: Union[str, Sequence[str], None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('library_segments', sa.Column('flags', sa.String(48), nullable=True))
    op.add_column('library_items', sa.Column('rebuildable', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('rebuildable')
    with op.batch_alter_table('library_segments') as batch:
        batch.drop_column('flags')
```

- [ ] **Step 4:模型(Edit,两处)。** `LibraryItem` 里 `low_confidence` 那行之后加:

```python
    # plan v2 R-V8:识别结果留在条目目录(transcript.json),可以不花钱重建句子
    rebuildable: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
```

  `LibrarySegment` 里 `analysis_lang` 那行之后加:

```python
    # plan v2 R-V14:这一句时间可疑的原因(逗号分隔,如 "rate,pause");NULL = 没有;手动改时间后清空
    flags: Mapped[str | None] = mapped_column(String(48), nullable=True)
```

- [ ] **Step 5:`app/library/store.py`(Edit,三处):**
  1. `item_out` 里 `"low_confidence": row.low_confidence,` → `"low_confidence": row.low_confidence, "rebuildable": row.rebuildable,`
  2. `segment_out` 的返回

```python
    return {"idx": row.idx, "start_ms": row.start_ms, "end_ms": row.end_ms, "text": row.text, "zh": row.zh,
            "zh_lang": row.zh_lang, "has_analysis": bool(row.analysis), "analysis_lang": row.analysis_lang}
```

  换成

```python
    return {"idx": row.idx, "start_ms": row.start_ms, "end_ms": row.end_ms, "text": row.text, "zh": row.zh,
            "zh_lang": row.zh_lang, "has_analysis": bool(row.analysis), "analysis_lang": row.analysis_lang,
            "flags": row.flags.split(",") if row.flags else []}
```

  3. `write_segments` 的签名到 `session.add_all(...)` 那条语句

```python
async def write_segments(session: AsyncSession, item: LibraryItem, sentences: list[Sentence]) -> None:
    """Replace every sentence of the item (caller commits). Old attempts stay; their text hash decides (R-SC14)."""
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item.id))
    session.add_all(LibrarySegment(item_id=item.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text)
                    for i, s in enumerate(sentences))
```

  换成(后面的 `item.seg_count = ...` 与 `item.resume_idx = ...` 两行不变)

```python
async def write_segments(session: AsyncSession, item: LibraryItem, sentences: list[Sentence], *,
                         flags: list[tuple[str, ...]] | None = None, keep_ai: bool = False) -> None:
    """Replace every sentence of the item (caller commits). Old attempts stay; their text hash decides (R-SC14).
    `flags` (plan v2 R-V14): one tuple of codes per sentence. `keep_ai` (rebuild, R-V16): a new sentence whose text is
    the same as an old one keeps that one's translation and analysis."""
    kept: dict[str, tuple] = {}
    if keep_ai:
        for old in await segments_of(session, item.id):
            kept.setdefault(" ".join(old.text.split()), (old.zh, old.zh_lang, old.analysis, old.analysis_lang))
            session.expunge(old)
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item.id))
    rows = []
    for i, s in enumerate(sentences):
        codes = flags[i] if flags is not None and i < len(flags) else ()
        zh, zh_lang, analysis, analysis_lang = kept.get(" ".join(s.text.split()), (None, None, None, None))
        rows.append(LibrarySegment(item_id=item.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                                   flags=",".join(codes) or None, zh=zh, zh_lang=zh_lang, analysis=analysis,
                                   analysis_lang=analysis_lang))
    session.add_all(rows)
```

- [ ] **Step 6:跑测试:** `cd server && uv run pytest -q tests/test_migrations.py tests/test_library_models.py tests/test_library_store.py tests/test_library_media_api.py tests/test_library_api.py tests/test_library_ai_api.py tests/test_architecture.py`。`test_models_match_migrations` 必须绿。**本任务不跑 `test_library_contract.py`**(T9 重录)。
- [ ] **Step 7:提交:**

```
feat(server): per-sentence timing flags and the rebuildable mark (migration 0020)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 7:流水线接线 —— 重叠、总入口、保留 `transcript.json`、`final_empty`

**Files:** Modify `server/app/library/pipeline.py`、`server/app/library/worker.py`;Create `server/tests/test_library_words_pipeline.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_words_pipeline.py`:

```python
"""词路径接进流水线(plan 2026-10-14-library-alignment-v2 R-V5、R-V8、R-V14):词级时间到达接口、硬切处重叠、
识别结果保留在条目目录、重新识别失败时旧的识别结果不动。助手也给 `test_library_rebuild.py` 用。"""
import pytest

from app.library import paths
from app.library.asr_chunks import load_transcript
from app.library.pipeline import TRANSCRIPT
from app.speech.timed import TimedText, Utterance, Word
from tests.library_helpers import FakeAsr, FakeTimedAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.library_words import utt

A = "SECRET-TRANSCRIPT welcome back to my channel."
B = "Today we talk about the city."
C = "It costs twenty five dollars, honestly."


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def timed(*utts: Utterance) -> TimedText:
    return TimedText(" ".join(u.text for u in utts), utts)


def transcript_path(app, uid: int, item_id: str):
    return paths.item_dir(app.state.library.deps.data_dir, uid, item_id) / TRANSCRIPT


async def uid_of(client, h) -> int:
    return int((await client.get("/api/me", headers=h)).json()["id"])


async def word_item(app, client, h, *results) -> str:
    """A 40 s audio item (one chunk, no silences) recognized with the given timed results."""
    use_fakes(app, FakeTools(silences=[]), timed_asr=FakeTimedAsr(list(results)))
    item_id = await upload(client, h, fake_media(40_000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    return item_id


async def detail(client, h, item_id) -> dict:
    return (await client.get(f"/api/library/items/{item_id}", headers=h)).json()


def mismatched() -> Utterance:
    """A recognizer sentence whose words do not match its text: every token is spread (`interp`) -> flagged `timing`."""
    return Utterance(C, 34_000, 36_000, (Word("zzz", 34_000, 34_500), Word("qqq", 35_000, 36_000)))


async def test_word_times_reach_the_api_and_the_transcript_is_kept(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000)))
    body = await detail(client, auth_headers, item_id)
    assert (body["item"]["status"], body["item"]["rebuildable"], body["item"]["low_confidence"]) == ("ready", True, False)
    assert [s["text"] for s in body["segments"]] == [A, B]
    assert body["segments"][0]["start_ms"] == 27_360 - 40 and body["segments"][0]["flags"] == []
    kept = load_transcript(transcript_path(app, await uid_of(client, auth_headers), item_id))
    assert kept is not None and kept[0][0].utterances[0].words[0] == Word("SECRET-TRANSCRIPT", 27_360, 27_660)
    assert not paths.tmp_dir(app.state.library.deps.data_dir, item_id).exists()


async def test_a_sentence_whose_words_do_not_match_is_flagged(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000), mismatched()))
    segs = (await detail(client, auth_headers, item_id))["segments"]
    assert segs[-1]["text"] == C and "timing" in segs[-1]["flags"]


async def test_hard_cuts_overlap_only_on_the_word_path(app, client, auth_headers):
    fake = FakeTimedAsr([timed(utt(A, 27_360)), ""])
    use_fakes(app, FakeTools(silences=[]), timed_asr=fake)
    item_id = await upload(client, auth_headers, fake_media(60_000, video=False), filename="Pod.m4a")
    await process(app)
    assert sorted(fake.calls) == [21_000, 41_000]  # [0, 41 s) and [39 s, 60 s)
    assert (await detail(client, auth_headers, item_id))["item"]["status"] == "ready"
    text_only = FakeAsr([A, ""])
    use_fakes(app, FakeTools(silences=[]), asr=text_only)
    await upload(client, auth_headers, fake_media(60_000, video=False), filename="Pod.m4a")
    await process(app)
    assert sorted(text_only.calls) == [20_000, 40_000]  # no times, no overlap: v1 chunks


async def test_a_failed_re_recognition_keeps_the_old_transcript(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360)))
    path = transcript_path(app, await uid_of(client, auth_headers), item_id)
    old = path.read_bytes()
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}), timed_asr=FakeTimedAsr([]))
    assert (await client.post(f"/api/library/items/{item_id}/reprocess", headers=auth_headers)).status_code == 200
    await process(app)
    item = (await detail(client, auth_headers, item_id))["item"]
    assert (item["status"], item["error_kind"], item["rebuildable"]) == ("ready", "corrupt", True)
    assert path.read_bytes() == old
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_words_pipeline.py`(`ImportError: cannot import name 'TRANSCRIPT'`)。
- [ ] **Step 3:`app/library/pipeline.py`(Edit,七处):**
  1. `from app.library import asr_chunks, limits, paths, quality, segment, store, subtitles` → `from app.library import asr_chunks, limits, paths, segment, sentences as sentences_mod, store, subtitles`
  2. `CHUNKS = "chunks.json"` 之后加一行

```python
TRANSCRIPT = "transcript.json"  # plan v2 R-V8: the kept recognizer output, in the item directory (not `_tmp`)
```
  3. `_transcribe` 的签名与文档字符串

```python
async def _transcribe(deps: PipelineDeps, item: LibraryItem, media: Path, duration_ms: int, tmp: Path,
                      progress: Progress, t0: int) -> tuple[list[segment.Sentence], bool]:
    """Chunked recognition -> sentences, plus the `low_confidence` verdict (spec D5: the recognizer's real times first)."""
```

  换成

```python
async def _transcribe(deps: PipelineDeps, item: LibraryItem, media: Path, duration_ms: int, tmp: Path,
                      progress: Progress, t0: int
                      ) -> tuple[sentences_mod.Built, list[asr_chunks.Chunk], list[asr_chunks.Silence]]:
    """Chunked recognition -> sentences with flags and the `low_confidence` verdict (plan v2: word times first), plus
    the chunks and silences the caller keeps as the item's transcript."""
```

  4. 规划块

```python
    if chunks is None:
        chunks = asr_chunks.plan_chunks(duration_ms, silences)
```

  换成

```python
    if chunks is None:
        overlap = limits.ASR_HARD_CUT_OVERLAP_MS if deps.timed_transcriber is not None else 0  # R-V5
        chunks = asr_chunks.plan_chunks(duration_ms, silences, overlap_ms=overlap)
```

  5. `_transcribe` 的结尾

```python
    sentences = segment.build(asr_chunks.fragments(chunks, silences), adjust=asr_chunks.snapper(silences))
    return sentences, quality.is_low_confidence(sentences, chunks, silences)
```

  换成

```python
    built = await asyncio.to_thread(sentences_mod.build, chunks, silences)
    logger.info("library sentences item=%s algorithm=%s sentences=%d flagged=%d low_confidence=%s", item.id,
                built.algorithm, len(built.sentences), sum(1 for f in built.flags if f), built.low_confidence)
    return built, chunks, silences
```

  6. `process` 里

```python
    sentences: list[segment.Sentence]
    low_confidence = False
```

  换成

```python
    sentences: list[segment.Sentence]
    flags: list[tuple[str, ...]] | None = None
    transcript: tuple[list[asr_chunks.Chunk], list[asr_chunks.Silence]] | None = None
    low_confidence = False
```

  以及

```python
        sentences, low_confidence = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0)
        sub_source = "asr"
```

  换成

```python
        built, chunks, silences = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0)
        sentences, flags, low_confidence = built.sentences, built.flags, built.low_confidence
        transcript = (chunks, silences)
        sub_source = "asr"
```

  7. 写库到清理

```python
    await progress.set("segment", 95)
    async with deps.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        if row is None or row.status != "processing":
            raise Aborted()
        await store.write_segments(s, row, sentences)
        row.sub_source, row.status, row.stage, row.progress = sub_source, "ready", None, 100
        row.low_confidence = low_confidence
        row.error_kind, row.source_url, row.next_run_at, row.attempts = None, None, None, 0
        row.updated_at = deps.clock()
        await s.commit()
    paths.remove_tree(tmp)
```

  换成

```python
    await progress.set("segment", 95)
    final = paths.item_dir(deps.data_dir, item.user_id, item.id)
    staged = final / (TRANSCRIPT + ".new")
    if transcript is not None:  # written before the commit, put in place after it (R-V8)
        await asyncio.to_thread(asr_chunks.save_transcript, staged, *transcript)
    async with deps.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        if row is None or row.status != "processing":
            staged.unlink(missing_ok=True)
            raise Aborted()
        await store.write_segments(s, row, sentences, flags=flags)
        row.sub_source, row.status, row.stage, row.progress = sub_source, "ready", None, 100
        row.low_confidence = low_confidence
        row.rebuildable = transcript is not None
        row.error_kind, row.source_url, row.next_run_at, row.attempts = None, None, None, 0
        row.updated_at = deps.clock()
        await s.commit()
    if transcript is not None:
        paths.replace(staged, final / TRANSCRIPT)
    else:
        (final / TRANSCRIPT).unlink(missing_ok=True)
    paths.remove_tree(tmp)
```

  (`quality` 不再被 `pipeline.py` 导入;`segment` 仍用于字幕路径。)

- [ ] **Step 4:`app/library/worker.py` 的 `install`(Edit):**

```python
        return make_timed_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id))
```

  换成

```python
        return make_timed_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id),
                                      final_empty=True)  # plan v2 R-V12: an empty answer = no speech, no fallback
```

- [ ] **Step 5:跑测试:** `cd server && uv run pytest -q tests/test_library_words_pipeline.py tests/test_library_worker.py tests/test_library_alignment.py tests/test_library_reprocess.py tests/test_library_privacy.py tests/test_library_asr_timed.py tests/test_architecture.py`。既有 `test_library_worker.py` / `test_library_alignment.py` / `test_library_reprocess.py` 必须不改而绿(传 `asr=` 的用例没有带时间的转写器 → 不重叠、走 v1;`test_a_tail_without_utterances_does_not_move_the_real_times` 现在规划成 `[0, 41 s)` + `[39 s, 60 s)`,第二块为空,结果不变)。
- [ ] **Step 6:提交:**

```
feat(server): library pipeline cuts sentences on word times and keeps the recognizer output

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 8:「重新分句」端点、换字幕删识别结果、手动改时间清标记

**Files:** Modify `server/app/library/errors.py`、`server/app/routers/library.py`、`server/tests/test_library_privacy.py`;Create `server/tests/test_library_rebuild.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_rebuild.py`:

```python
"""「重新分句」(plan 2026-10-14-library-alignment-v2 R-V8、R-V14、R-V16):用保留的识别结果按当前算法重建句子,不花识别额度;
没有识别结果就拒绝;换字幕删掉识别结果;手动改时间清掉这句的标记。"""
import logging

from sqlalchemy import select

from app.library import wordseg
from app.models import DailyUsage, LibrarySegment
from tests.library_helpers import SRT, FakeAsr, FakeTimedAsr, FakeTools, fake_media, process, upload, use_fakes
from tests.library_words import utt
from tests.test_library_privacy import leaked
from tests.test_library_words_pipeline import (  # noqa: F401  (`settings_overrides` and `_tools` are fixtures)
    A, B, _tools, detail, mismatched, settings_overrides, timed, transcript_path, uid_of, word_item,
)


async def test_rebuild_uses_the_current_algorithm_without_paying_again(app, client, auth_headers, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    fake = FakeTimedAsr([timed(utt(A, 27_360), utt(B, 31_000))])
    use_fakes(app, FakeTools(silences=[]), timed_asr=fake)
    item_id = await upload(client, auth_headers, fake_media(40_000, video=False), filename="Pod.m4a")
    await process(app)
    async with app.state.sessionmaker() as s:
        spent = (await s.scalars(select(DailyUsage.count).where(DailyUsage.scope == "library_asr"))).all()
    before = (await detail(client, auth_headers, item_id))["segments"]
    monkeypatch.setattr(wordseg, "TAIL_PAD_MS", 0)  # stands for "the algorithm improved after recognition"
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)
    assert r.status_code == 200, r.text
    after = r.json()["segments"]
    assert [s["text"] for s in after] == [s["text"] for s in before]
    assert after[0]["end_ms"] == before[0]["end_ms"] - 80  # the new rule, applied to the kept words
    assert len(fake.calls) == 1  # no new recognition
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(DailyUsage.count).where(DailyUsage.scope == "library_asr"))).all() == spent
    assert leaked(caplog) == []


async def test_rebuild_replaces_edits_but_keeps_translations_of_unchanged_sentences(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000)))
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                .order_by(LibrarySegment.idx))).all()
        rows[0].zh, rows[0].zh_lang = "欢迎回来。", "zh-CN"
        rows[1].zh, rows[1].zh_lang = "今天聊城市。", "zh-CN"
        await s.commit()
    await client.patch(f"/api/library/items/{item_id}/segments/1", headers=auth_headers, json={"text": "Edited words here."})
    after = (await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)).json()["segments"]
    assert [(s["text"], s["zh"]) for s in after] == [(A, "欢迎回来。"), (B, None)]


async def test_rebuild_is_refused_without_a_kept_transcript(app, client, auth_headers):
    h = auth_headers
    use_fakes(app)
    subs = await upload(client, h, fake_media(), subs=SRT)
    await process(app)
    r = await client.post(f"/api/library/items/{subs}/rebuild", headers=h)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be rebuilt"})
    item_id = await word_item(app, client, h, timed(utt(A, 27_360)))
    transcript_path(app, await uid_of(client, h), item_id).unlink()
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=h)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be rebuilt"})
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert (await client.post(f"/api/library/items/{item_id}/rebuild", headers=bob)).status_code == 404


async def test_text_only_items_keep_their_transcript_too(app, client, auth_headers):
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([f"{A} {B}"]))
    item_id = await upload(client, auth_headers, fake_media(40_000, video=False), filename="Pod.m4a")
    await process(app)
    before = (await detail(client, auth_headers, item_id))["segments"]
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)
    assert r.status_code == 200 and r.json()["segments"] == before  # v1 again: the same sentences


async def test_new_subtitles_drop_the_transcript(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360)))
    path = transcript_path(app, await uid_of(client, auth_headers), item_id)
    assert path.is_file()
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert r.status_code == 200 and r.json()["item"]["rebuildable"] is False and not path.exists()


async def test_moving_a_sentence_by_hand_clears_its_flags_but_editing_text_does_not(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), mismatched()))
    url = f"/api/library/items/{item_id}/segments/1"
    seg = (await client.patch(url, headers=auth_headers, json={"text": "It costs 25 dollars, honestly."})).json()["segment"]
    assert "timing" in seg["flags"]
    seg = (await client.patch(url, headers=auth_headers, json={"start_ms": seg["start_ms"] + 100})).json()["segment"]
    assert seg["flags"] == []
```

  `tests/test_library_privacy.py` 的 `ROUTES`:`("POST", "/api/library/items/{item_id}/reprocess"), ` 之后加 `("POST", "/api/library/items/{item_id}/rebuild"), `(换行对齐随意)。

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_rebuild.py tests/test_library_privacy.py`。
- [ ] **Step 3:`app/library/errors.py`(Edit):** `"asr_daily": (429, "Daily transcription limit reached"),` 之后加 `"not_rebuildable": (409, "Item cannot be rebuilt"),  # plan v2 R-V16`。
- [ ] **Step 4:`app/routers/library.py`(Edit,五处):**
  1. 顶部的 `import logging` 之前加一行 `import asyncio`。
  2. `from app.library import limits, paths, segment, store, subtitles` → `from app.library import asr_chunks, limits, paths, segment, sentences, store, subtitles`;`from app.library.pipeline import UPLOADED_SUBS, INPUT_PREFIX` → `from app.library.pipeline import TRANSCRIPT, UPLOADED_SUBS, INPUT_PREFIX`
  3. 在 `@router.put("/items/{item_id}/subtitles")` 之前插入:

```python
@router.post("/items/{item_id}/rebuild")
async def rebuild_item(request: Request, item_id: ItemId, user: User = Depends(limited_user),
                       settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    """plan v2 R-V16:用条目目录里保留的识别结果(transcript.json)按当前算法重新分句,不花识别额度、不排队。
    手动改过的句子被替换;文字没变的句子保留译文与分析。日志只有条目 id 与数字。"""
    item = await owned(session, user, item_id)
    if item.status != "ready" or item.sub_source != "asr" or not item.rebuildable:
        raise fail("not_rebuildable")
    path = paths.item_dir(settings.resolved_data_dir, item.user_id, item.id) / TRANSCRIPT
    async with runtime(request).upload_lock(item.id):
        loaded = await asyncio.to_thread(asr_chunks.load_transcript, path)
        if loaded is None:
            raise fail("not_rebuildable")
        built = await asyncio.to_thread(sentences.build, *loaded)
        await session.refresh(item)
        if not built.sentences or item.status != "ready":
            raise fail("not_rebuildable")
        await store.write_segments(session, item, built.sentences, flags=built.flags, keep_ai=True)
        item.low_confidence, item.updated_at = built.low_confidence, utcnow()
        await session.commit()
    segs = await store.segments_of(session, item.id)
    logger.info("library rebuilt item=%s algorithm=%s sentences=%d flagged=%d", item.id, built.algorithm,
                len(built.sentences), sum(1 for f in built.flags if f))
    return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}


```

  4. `put_item_subtitles` 的 ready 分支

```python
        item.sub_source, item.error_kind, item.low_confidence, item.updated_at = "uploaded", None, False, utcnow()
        await session.commit()
```

  换成

```python
        item.sub_source, item.error_kind, item.low_confidence, item.updated_at = "uploaded", None, False, utcnow()
        item.rebuildable = False  # the recognizer's output is no longer the source (R-V8): drop it
        await session.commit()
        (paths.item_dir(settings.resolved_data_dir, item.user_id, item.id) / TRANSCRIPT).unlink(missing_ok=True)
```

  5. `patch_segment` 里

```python
    if not (low <= start < end <= high):
        raise fail("bad_times")
    seg.start_ms, seg.end_ms = start, end
```

  换成

```python
    if not (low <= start < end <= high):
        raise fail("bad_times")
    if (start, end) != (seg.start_ms, seg.end_ms):
        seg.flags = None  # R-V14: the learner set the times by ear
    seg.start_ms, seg.end_ms = start, end
```

- [ ] **Step 5:跑测试:** `cd server && uv run pytest -q tests/test_library_rebuild.py tests/test_library_words_pipeline.py tests/test_library_privacy.py tests/test_library_media_api.py tests/test_library_reprocess.py tests/test_library_api.py tests/test_architecture.py`。**不跑 `test_library_contract.py`**(T9)。
- [ ] **Step 6:提交:**

```
feat(server): rebuild library sentences from the kept recognition without paying again

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 9:契约夹具重录(服务端)

**Files:** Modify `server/tests/test_library_contract.py`、`server/tests/fixtures/library_contract.json`。

- [ ] **Step 1:录 `rebuild`。** `test_library_contract.py`:在 `out["reprocess_error"] = ...` 那行之前加

```python
    out["rebuild"] = (await client.post(f"/api/library/items/{asr_id}/rebuild", headers=h)).json()
    out["rebuild_error"] = (await client.post(f"/api/library/items/{item_id}/rebuild", headers=h)).json()
```

  在 `assert out["reprocess"]["item"]["status"] == "queued" and ...` 那行之后加

```python
    assert out["rebuild"]["item"]["rebuildable"] is True and out["rebuild"]["segments"]
    assert out["rebuild_error"] == {"error": "Item cannot be rebuilt"}
```

  (顺序要紧:`rebuild` 必须在 `reprocess` 之前,重新识别会把条目变成 `queued`。)
- [ ] **Step 2:重录并逐项读 diff:** `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_library_contract.py`,再不带变量跑一次确认绿。写计划时在副本里实测,语义差异**只有**:每个条目对象多 `rebuildable`(`items`、`item_detail`、`item_patch`、`cancel`、`subtitles_replace`、`upload_complete`、`reprocess`)、每个句子对象多 `"flags": []`(`item_detail`、`item_detail_with_ai`、`segment_patch`、`subtitles_replace`)、`errors.not_rebuildable`、新键 `rebuild` / `rebuild_error`。出现别的变化先查原因,不要直接提交。
- [ ] **Step 3:跑测试:** `cd server && uv run pytest -q tests/test_library_contract.py tests/test_architecture.py`。
- [ ] **Step 4:提交:**

```
test(server): re-record the library contract (flags, rebuildable, rebuild)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 10:评估脚本(一致性报告、金标准模板、打分)

**Files:** Create `server/scripts/library_alignment_eval.py`、`server/tests/test_library_alignment_eval.py`。

- [ ] **Step 1:写测试(先红)** `server/tests/test_library_alignment_eval.py`:

```python
"""评估脚本(plan 2026-10-14-library-alignment-v2 Task 9):无参照的一致性报告、金标准模板与打分;只输出数字。"""
import json

from app.library.asr_chunks import save_transcript
from app.library.segment import Sentence
from scripts.library_alignment_eval import (
    cuts_inside_words, edge_offsets, gold_errors, main, sample_rows, verdict, violations, word_free_spans,
)
from tests.library_words import chunk, run, utt

SECRET = "SECRET-TRANSCRIPT"


def transcript(tmp_path):
    a = utt(f"{SECRET} welcome back to my channel.", 27_360, word_ms=250, gap_ms=40)
    b = utt("So we went to the market and then we bought food.", 31_000, word_ms=250, gap_ms=40, gaps={5: 3_000})
    c = utt("Okay.", 60_000, word_ms=300)
    path = tmp_path / "transcript.json"
    save_transcript(path, [chunk(0, 70_000, a, b, c)], [])
    return path


def test_report_prints_numbers_only_and_v2_never_cuts_a_word(tmp_path, capsys):
    assert main(["report", "--transcript", str(transcript(tmp_path)), "--label", "T"]) == 0
    out = capsys.readouterr().out
    assert SECRET not in out and "market" not in out
    now = json.loads(out.split("- now:")[1].splitlines()[0])
    v1 = json.loads(out.split("- v1:")[1].splitlines()[0])
    assert now["cuts_inside_words"] == 0 and now["violations"] == {"inverted": 0, "overlapping": 0, "not_monotonic": 0}
    assert now["lead"]["max"] <= 40 and now["pauses_over_1500_inside"] == 0
    assert v1["pauses_over_1500_inside"] >= 1  # v1 kept the 3 s pause inside a sentence
    assert "word_free_spans_s" in out


def test_sample_writes_a_times_only_template(tmp_path, capsys):
    out_file = tmp_path / "gold.json"
    assert main(["sample", "--transcript", str(transcript(tmp_path)), "--n", "3", "--out", str(out_file)]) == 0
    rows = json.loads(out_file.read_text("utf-8"))
    assert len(rows) == 3 and set(rows[0]) == {"ours_start_ms", "ours_end_ms", "true_start_ms", "true_end_ms"}
    assert SECRET not in capsys.readouterr().out


def test_score_against_a_gold_file(tmp_path, capsys):
    path = transcript(tmp_path)
    gold = tmp_path / "gold.json"
    gold.write_text(json.dumps([{"true_start_ms": 27_360, "true_end_ms": 29_060},
                                {"true_start_ms": 60_000, "true_end_ms": 60_300},
                                {"true_start_ms": None, "true_end_ms": None}]), encoding="utf-8")
    assert main(["score", "--transcript", str(path), "--gold", str(gold)]) == 0
    out = capsys.readouterr().out
    now = json.loads(out.split("- gold now:")[1].splitlines()[0])
    assert now["n"] == 2 and now["start_p95"] <= 40 and now["end_p95"] <= 80 and now["clip_rate"] == 0
    assert json.loads(out.split("- gold verdict:")[1].splitlines()[0])["start_p50"] == "PASS"


def test_pure_metrics():
    tokens = run(["a", "b", "c"], start_ms=1_000)  # 1000-1300, 1360-1660, 1720-2020
    inside = [Sentence(1_100, 1_700, "x")]
    assert cuts_inside_words(inside, tokens) == 1
    assert edge_offsets([Sentence(900, 2_100, "x")], tokens) == ([100], [80], 0)
    assert violations([Sentence(0, 10, "a"), Sentence(5, 4, "b")]) == {"inverted": 1, "overlapping": 1, "not_monotonic": 0}
    assert word_free_spans(tokens, 10_000) == [(2_020, 10_000)]
    assert sample_rows([], 5, 1) == []
    assert gold_errors([Sentence(1_000, 2_000, "x")], [{"true_start_ms": 900, "true_end_ms": 2_100}])["clip_rate"] == 1.0
    assert verdict({"n": 0})["start_p50"] is None
```

- [ ] **Step 2:跑一次确认红:** `cd server && uv run pytest -q tests/test_library_alignment_eval.py`。
- [ ] **Step 3:写脚本** `server/scripts/library_alignment_eval.py`:

```python
"""Sentence-boundary evaluation for one library item (plan 2026-10-14-library-alignment-v2 Task 9). No network, no cost.

It reads the item's kept recognizer output (`library/<uid>/<item>/transcript.json`), runs the CURRENT algorithm and v1 on
it, and prints numbers only (never sentence text):

    report  ground-truth-free consistency: monotonic / overlap violations, edges sitting off the words, boundaries cutting
            a word, pauses kept inside sentences, word-free stretches (possible missed speech), seams, flags, rates
    sample  pick N sentences spread over the item and write a gold template (times only) you fill in by listening
    score   compare the current algorithm (and v1) with your filled-in gold file: median / p95 boundary error, bias,
            clipping rate, and the plan's targets (UNVERIFIED until a real gold file exists)

Inside the container (the script is not in the image):

    docker compose cp server/scripts/library_alignment_eval.py server:/tmp/eval.py
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py report --item-id <item-id>
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py sample --item-id <item-id> --n 30 --out /tmp/gold.json
    docker compose cp server:/tmp/gold.json ./gold.json      # fill in true_start_ms / true_end_ms, then copy it back
    docker compose exec -e PYTHONPATH=/app server python /tmp/eval.py score --item-id <item-id> --gold /tmp/gold.json
    docker compose exec -u root server rm -f /tmp/eval.py /tmp/gold.json

Gold labels: open the item's own media (`library/<uid>/<item>/media.*`, same time base as the sentences; the original
file can be shifted by encoder padding) in an audio editor, and for each sampled sentence write where the first word
really starts and the last word really ends, in ms (about 10 ms precision).
"""
import argparse
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TARGETS = {"start_p50": 120, "start_p95": 400, "end_p50": 150, "end_p95": 500, "clip_rate": 0.05}
CLIP_START_MS = 50  # starting this much after the true start clips the first sound
CLIP_END_MS = 80  # ending this much before the true end clips the last sound
INSIDE_MARGIN_MS = 30
WORD_FREE_MS = 5_000


# ---- pure helpers (unit-tested; numbers only) ----

def pct(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))]


def summary(values) -> dict:
    return {"n": len(values), "p50": pct(values, 50), "p95": pct(values, 95), "max": max(values, default=None)}


def words_inside(sentence, tokens):
    return [t for t in tokens if t.kind == "word" and sentence.start_ms <= t.mid_ms <= sentence.end_ms]


def edge_offsets(sentences, tokens) -> tuple[list[int], list[int], int]:
    """(leads, tails, sentences without any word): lead = first word start - sentence start (> 0 = silence or music
    included at the front), tail = sentence end - last word end."""
    leads, tails, empty = [], [], 0
    for s in sentences:
        inside = words_inside(s, tokens)
        if not inside:
            empty += 1
            continue
        leads.append(inside[0].start_ms - s.start_ms)
        tails.append(s.end_ms - inside[-1].end_ms)
    return leads, tails, empty


def cuts_inside_words(sentences, tokens) -> int:
    """Sentence edges that fall inside a word (by more than 30 ms on both sides): a clipped or doubled word."""
    edges = [x for s in sentences for x in (s.start_ms, s.end_ms)]
    return sum(1 for x in edges for t in tokens
               if t.kind == "word" and t.start_ms + INSIDE_MARGIN_MS < x < t.end_ms - INSIDE_MARGIN_MS)


def violations(sentences) -> dict:
    return {"inverted": sum(1 for s in sentences if s.end_ms <= s.start_ms),
            "overlapping": sum(1 for a, b in zip(sentences, sentences[1:]) if b.start_ms < a.end_ms),
            "not_monotonic": sum(1 for a, b in zip(sentences, sentences[1:]) if b.start_ms < a.start_ms)}


def word_free_spans(tokens, limit_ms: int, min_ms: int = WORD_FREE_MS) -> list[tuple[int, int]]:
    """Stretches of at least `min_ms` without any token (music, silence, or speech the recognizer missed)."""
    out, last = [], 0
    for t in tokens:
        if t.start_ms - last >= min_ms:
            out.append((last, t.start_ms))
        last = max(last, t.end_ms)
    if limit_ms - last >= min_ms:
        out.append((last, limit_ms))
    return out


def inner_pauses(sentences, tokens, over_ms: int = 1_500) -> int:
    count = 0
    for s in sentences:
        inside = words_inside(s, tokens)
        if any(b.start_ms - a.end_ms > over_ms for a, b in zip(inside, inside[1:])):
            count += 1
    return count


def sample_rows(sentences, n: int, seed: int) -> list[dict]:
    """N sentences spread evenly over the item (one random pick inside each of N equal slices), times only."""
    if not sentences:
        return []
    rng = random.Random(seed)
    n = min(n, len(sentences))
    rows = []
    for k in range(n):
        lo, hi = k * len(sentences) // n, max(k * len(sentences) // n, (k + 1) * len(sentences) // n - 1)
        s = sentences[rng.randint(lo, hi)]
        rows.append({"ours_start_ms": s.start_ms, "ours_end_ms": s.end_ms, "true_start_ms": None, "true_end_ms": None})
    return rows


def match(sentences, start_ms: int, end_ms: int):
    """The sentence that overlaps [start, end] the most (ties: the closest start)."""
    def key(s):
        overlap = min(s.end_ms, end_ms) - max(s.start_ms, start_ms)
        return (overlap, -abs(s.start_ms - start_ms))
    return max(sentences, key=key, default=None)


def gold_errors(sentences, gold: list[dict]) -> dict:
    starts, ends, clipped = [], [], 0
    for row in gold:
        ts, te = row.get("true_start_ms"), row.get("true_end_ms")
        if not isinstance(ts, (int, float)) or not isinstance(te, (int, float)) or te <= ts:
            continue
        s = match(sentences, ts, te)
        if s is None:
            continue
        starts.append(s.start_ms - ts)
        ends.append(s.end_ms - te)
        if s.start_ms - ts > CLIP_START_MS or te - s.end_ms > CLIP_END_MS:
            clipped += 1
    n = len(starts)
    return {"n": n, "start_p50": pct([abs(x) for x in starts], 50), "start_p95": pct([abs(x) for x in starts], 95),
            "end_p50": pct([abs(x) for x in ends], 50), "end_p95": pct([abs(x) for x in ends], 95),
            "start_bias_p50": pct(starts, 50), "end_bias_p50": pct(ends, 50),
            "clip_rate": round(clipped / n, 3) if n else None}


def verdict(errors: dict) -> dict:
    """PASS / FAIL against the plan's targets (None when there is no gold row)."""
    if not errors["n"]:
        return {k: None for k in TARGETS}
    return {k: ("PASS" if errors[k] is not None and errors[k] <= limit else "FAIL") for k, limit in TARGETS.items()}


def report_numbers(built, v1, tokens, chunks) -> dict:
    limit = max((c.end_ms for c in chunks), default=0)
    out = {"algorithm": built.algorithm, "sentences": len(built.sentences), "low_confidence": built.low_confidence,
           "flags": dict(sorted(Counter(f for fl in built.flags for f in fl).items())),
           "flagged_sentences": sum(1 for f in built.flags if f),
           "chunks": len(chunks), "empty_chunks": sum(1 for c in chunks if c.text is not None and not c.text.strip()),
           "overlapping_seams": sum(1 for a, b in zip(chunks, chunks[1:]) if b.start_ms < a.end_ms),
           "seam_tokens": sum(1 for t in tokens if t.seam),
           "token_kinds": dict(sorted(Counter(t.kind for t in tokens).items())),
           "word_free_spans_s": [(round(a / 1000, 1), round(b / 1000, 1)) for a, b in word_free_spans(tokens, limit)]}
    for name, result in (("now", built), ("v1", v1)):
        leads, tails, empty = edge_offsets(result.sentences, tokens)
        out[name] = {"violations": violations(result.sentences), "lead": summary([abs(x) for x in leads]),
                     "tail": summary([abs(x) for x in tails]), "no_words": empty,
                     "cuts_inside_words": cuts_inside_words(result.sentences, tokens),
                     "pauses_over_1500_inside": inner_pauses(result.sentences, tokens),
                     "duration_ms": summary([s.end_ms - s.start_ms for s in result.sentences])}
    return out


def markdown(label: str, numbers: dict, scores: dict | None = None) -> str:
    lines = [f"### 评估 {label}", ""]
    lines += [f"- {k}:{json.dumps(v, ensure_ascii=False)}" for k, v in numbers.items()]
    if scores is not None:
        lines += [f"- gold {k}:{json.dumps(v, ensure_ascii=False)}" for k, v in scores.items()]
    return "\n".join(lines) + "\n"


# ---- the real run ----

def transcript_path(args) -> Path:
    if args.transcript:
        return Path(args.transcript)
    from app.core.config import Settings

    root = Path(args.data_dir) if args.data_dir else Settings().resolved_data_dir
    found = sorted((root / "library").glob(f"*/{args.item_id}/transcript.json"))
    if not found:
        raise SystemExit("no kept transcript for that item (processed before plan v2, or its subtitles were replaced)")
    return found[0]


def load(args):
    from app.library import asr_chunks, sentences, timeline

    loaded = asr_chunks.load_transcript(transcript_path(args))
    if loaded is None:
        raise SystemExit("the transcript file is not readable")
    chunks, silences = loaded
    return chunks, sentences.build(chunks, silences), sentences.build_v1(chunks, silences), \
        timeline.tokens_for(chunks, silences)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("command", choices=("report", "sample", "score"))
    where = p.add_mutually_exclusive_group(required=True)
    where.add_argument("--item-id")
    where.add_argument("--transcript", help="path of a transcript.json (instead of --item-id)")
    p.add_argument("--data-dir", help="defaults to the server's DATA_DIR")
    p.add_argument("--n", type=int, default=30)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--out", help="sample: where to write the gold template")
    p.add_argument("--gold", help="score: the filled-in gold file")
    p.add_argument("--label", default="item")
    p.add_argument("--append-to", help="append the Markdown block to this file (the results document)")
    args = p.parse_args(argv)
    chunks, built, v1, tokens = load(args)
    if args.command == "sample":
        rows = sample_rows(built.sentences, args.n, args.seed)
        if args.out:
            Path(args.out).write_text(json.dumps(rows, indent=1), encoding="utf-8")
        for i, r in enumerate(rows):
            print(f"{i:3d}  {r['ours_start_ms'] / 1000:9.3f} - {r['ours_end_ms'] / 1000:9.3f} s   "
                  f"listen {max(0, r['ours_start_ms'] - 1500) / 1000:.1f} - {(r['ours_end_ms'] + 1500) / 1000:.1f} s")
        return 0
    numbers = report_numbers(built, v1, tokens, chunks)
    scores = None
    if args.command == "score":
        if not args.gold:
            raise SystemExit("score needs --gold")
        gold = json.loads(Path(args.gold).read_text(encoding="utf-8"))
        now, old = gold_errors(built.sentences, gold), gold_errors(v1.sentences, gold)
        scores = {"now": now, "v1": old, "targets": TARGETS, "verdict": verdict(now)}
    block = markdown(args.label, numbers, scores)
    print(block)
    if args.append_to:
        with open(args.append_to, "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4:跑测试:** `cd server && uv run pytest -q tests/test_library_alignment_eval.py tests/test_architecture.py`。
- [ ] **Step 5:提交:**

```
feat(server): library sentence-boundary evaluation (consistency report, gold template, scoring)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 11:网页 —— 类型、契约、`patchSegment` / `mergeSaved`、文案

**Files:** Modify `web/src/features/library/{library-api.ts, library-contract.test.ts, attempts-api.ts, shadow-panel.tsx, shadow-panel.test.tsx, locales/en.json, locales/zh-CN.json}`。

- [ ] **Step 1:`library-api.ts`(Edit,四处):**
  1. `LibraryItem` 里

```ts
  /** D5:句边界可能不准(服务端合理性检查;重新识别后重算) */
  lowConfidence: boolean;
```

  之后加

```ts
  /** plan v2 R-V8:服务端留着识别结果,可以「重新分句」(不花识别额度)。可选:旧夹具与测试里的条目不必带。 */
  rebuildable?: boolean;
```

  2. `LibrarySegment` 末尾(`hasAnalysis?: boolean;` 之后的两行)

```ts
  analysisLang?: string | null;
}
```

  换成

```ts
  analysisLang?: string | null;
  /**
   * plan v2 R-V14:这一句时间可疑的原因码(`rate` / `pause` / `timing` / `estimated` / `seam`);空 = 没有。
   * 用户手动改过时间后服务端清空。可选:旧服务端与测试里的句子没有。
   */
  flags?: string[];
}
```

  3. `export async function putItemSubtitles(` 之前加

```ts
/** plan v2 R-V16:用保留的识别结果按当前算法重新分句(不花额度、不排队);返回新的句子。旧素材没有识别结果 → 409。 */
export async function rebuildItem(api: ApiClient, id: string): Promise<LibraryItemDetail> {
  return unwrapDetail(await api.request<unknown>("POST", `${itemPath(id)}/rebuild`));
}

```

  4. `LIBRARY_SERVER_ERRORS` 里 `"Item cannot be reprocessed": "web.library.errors.notReprocessable",` 之后加 `"Item cannot be rebuilt": "web.library.errors.notRebuildable",`

- [ ] **Step 2:`library-contract.test.ts`(Edit,三处):** `ITEM` 键表 `lowConfidence: true, createdAt: true, lastOpenedAt: true,` → `lowConfidence: true, rebuildable: true, createdAt: true, lastOpenedAt: true,`;`SEGMENT` 键表的结尾

```ts
  idx: true, startMs: true, endMs: true, text: true, zh: true, zhLang: true, hasAnalysis: true, analysisLang: true,
};
```

  换成

```ts
  idx: true, startMs: true, endMs: true, text: true, zh: true, zhLang: true, hasAnalysis: true, analysisLang: true,
  flags: true,
};
```

  在 `it("every item carries the low_confidence flag as a boolean", () => {` 之前加

```ts
  it("rebuild returns the item with its new sentences, and refuses an item without a kept transcript (plan v2)", () => {
    const rebuilt = unwrapDetail(cc<unknown>(c.rebuild));
    expect(keysOf(rebuilt)).toEqual(keys(DETAIL));
    expect(rebuilt.rebuildable).toBe(true);
    expect(rebuilt.segments.length).toBeGreaterThan(0);
    for (const seg of rebuilt.segments) expect(Array.isArray(seg.flags) && seg.flags.every((f) => typeof f === "string")).toBe(true);
    expect(c.rebuild_error).toEqual({ error: "Item cannot be rebuilt" });
  });

```

- [ ] **Step 3:`attempts-api.ts`(Edit,两处):** `SegmentWithAi` 的结尾

```ts
  analysisLang?: string | null;
};
```

  换成

```ts
  analysisLang?: string | null;
  /** plan v2 R-V14:时间可疑的原因码;服务端在时间被改后清空 */
  flags?: string[];
};
```

  `patchSegment` 里 `  if ("analysisLang" in r) saved.analysisLang = typeof r.analysisLang === "string" ? r.analysisLang : null;` 之后加 `  if (Array.isArray(r.flags)) saved.flags = r.flags.filter((f): f is string => typeof f === "string");`(`attempts-contract.test.ts` 要求回包字段原样带回)。
- [ ] **Step 4:`shadow-panel.tsx` 的 `mergeSaved`(Edit):**

```ts
/** 微调保存后的新句子:起止与文字取服务端回的;文字变了就清掉译文与分析(E11,R-SH34)。 */
export function mergeSaved(segment: LibrarySegment, saved: SavedSegment): LibrarySegment {
  const next: LibrarySegment = { ...segment, startMs: saved.startMs, endMs: saved.endMs, text: saved.text };
```

  换成

```ts
/**
 * 微调保存后的新句子:起止与文字取服务端回的;文字变了就清掉译文与分析(E11,R-SH34);
 * 起止变了就清掉时间可疑标记(plan v2 R-V14,与服务端同一规则)。
 */
export function mergeSaved(segment: LibrarySegment, saved: SavedSegment): LibrarySegment {
  const timesChanged = saved.startMs !== segment.startMs || saved.endMs !== segment.endMs;
  const next: LibrarySegment = {
    ...segment, startMs: saved.startMs, endMs: saved.endMs, text: saved.text, ...(timesChanged && segment.flags ? { flags: [] } : {}),
  };
```

  `shadow-panel.test.tsx` 末尾追加:

```ts
describe("mergeSaved timing flags (plan v2 R-V14)", () => {
  it("clears the timing flags when the times change, keeps them when only the text changes", () => {
    const flagged = { ...SEG, flags: ["pause"] } as LibrarySegment;
    expect(mergeSaved(flagged, { idx: SEG.idx, startMs: SEG.startMs + 100, endMs: SEG.endMs, text: SEG.text }).flags).toEqual([]);
    expect(mergeSaved(flagged, { idx: SEG.idx, startMs: SEG.startMs, endMs: SEG.endMs, text: "Other words." }).flags).toEqual(["pause"]);
  });
});
```

- [ ] **Step 5:文案(两个 locales,`web.library` 下,单行锚点 Edit)。** `zh-CN.json`:
  - `"reprocess": "重新识别",` 之后加 `"rebuild": "重新分句(不用额度)",`
  - `"confirmReprocess": {` 之前加

```json
      "confirmRebuild": {
        "title": "重新分句这条素材?",
        "body": "用已经识别好的结果按最新的方法重新切句子,不用自动转写额度。你对句子文字和时间的修改会被替换;文字没变的句子保留译文。",
        "confirm": "重新分句"
      },
```

  - `"reprocessing": "已开始重新识别。"` → `"reprocessing": "已开始重新识别。",` 并在其后加 `"rebuilt": "已重新分句。"`
  - `"notReprocessable": "这条素材现在不能重新识别。",` 之后加 `"notRebuildable": "这条素材是更早的版本识别的,没有保留识别结果;请用「重新识别」。",`
  - `"noSegments": "还没有句子。",` 之后加 `"timingSuspect": "这句的时间可能不准,可微调",`

  `en.json`(同样的位置):`"rebuild": "Re-split sentences (free)",`;`"confirmRebuild": { "title": "Re-split this item's sentences?", "body": "The sentences are cut again from the existing recognition with the latest method. This uses no transcription allowance. Your edits to sentence text and times are replaced; sentences whose text did not change keep their translations.", "confirm": "Re-split" }`(按上面的多行格式);`"rebuilt": "Sentences re-split."`;`"notRebuildable": "This item was recognized by an earlier version and has no kept recognition. Use Re-recognize instead.",`;`"timingSuspect": "This sentence's timing may be off; you can fine-tune it",`。

- [ ] **Step 6:跑测试:** `cd web && yarn web:typecheck && yarn vitest run src/features/library/library-contract.test.ts src/features/library/attempts-contract.test.ts src/features/library/shadow-panel.test.tsx src/features/library/library-api.test.ts src/features/library/locales.test.ts src/architecture.test.ts`(`locales.test.ts` 要求两种语言的键与占位符一致)。
- [ ] **Step 7:提交:**

```
feat(web): library types for sentence flags and rebuild

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 12:网页界面 —— 菜单「重新分句」、确认、可疑句圆点、不越过空隙的缓冲

**Files:** Modify `web/src/features/library/{item-menu.tsx, item-menu.test.tsx, item-card.tsx, item-card.test.tsx, library-list-page.tsx, library-list-page.test.tsx, segment-list.tsx, segment-list.test.tsx, use-media-player.ts, use-media-player.test.ts}`。

- [ ] **Step 1:测试(先红)。**
  1. `item-menu.test.tsx` 末尾追加:

```tsx
describe("ItemMenu (plan v2 R-V16)", () => {
  it("offers re-splitting for an item whose recognition was kept, and closes before handing it over", async () => {
    const onRebuild = vi.fn();
    render(<ItemMenu item={{ ...item, rebuildable: true }} onReprocess={vi.fn()} onRebuild={onRebuild} />);
    await userEvent.click(screen.getByTestId("library-item-more-i1"));
    expect(await screen.findByTestId("menu-rebuild")).toHaveTextContent("重新分句(不用额度)");
    await userEvent.click(screen.getByTestId("menu-rebuild"));
    expect(onRebuild).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
    expect(screen.queryByTestId("library-item-menu")).toBeNull();
  });

  it("shows only the actions it was given", async () => {
    render(<ItemMenu item={{ ...item, rebuildable: true }} onRebuild={vi.fn()} />);
    await userEvent.click(screen.getByTestId("library-item-more-i1"));
    expect(await screen.findByTestId("menu-rebuild")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-reprocess")).toBeNull();
  });

  it("hides re-splitting when nothing was kept", async () => {
    render(<ItemMenu item={item} onReprocess={vi.fn()} onRebuild={vi.fn()} />);
    await userEvent.click(screen.getByTestId("library-item-more-i1"));
    expect(await screen.findByTestId("menu-reprocess")).toBeInTheDocument();
    expect(screen.queryByTestId("menu-rebuild")).toBeNull();
  });
});
```

  2. `item-card.test.tsx` 末尾追加:

```tsx
describe("ItemCard re-splitting (plan v2 R-V16)", () => {
  it("shows the more menu for a rebuildable item even when the server has transcription off", async () => {
    const { onReprocess: _omitted, ...without } = handlers();
    const onRebuild = vi.fn();
    card({ item: { ...base, subSource: "asr", rebuildable: true }, ...without, onRebuild });
    fireEvent.click(screen.getByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    expect(onRebuild).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("never offers re-splitting for subtitles or items without a kept recognition", () => {
    card({ item: { ...base, rebuildable: true }, ...handlers(), onRebuild: vi.fn() });
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });
});
```

  3. `library-list-page.test.tsx`:在 `it("has no re-recognize action when the server has transcription off", async () => {` 之前插入:

```tsx
  it("re-splits a rebuildable item after confirmation, without using the allowance (plan v2)", async () => {
    const segments: Record<string, unknown>[] = [{ idx: 0, start_ms: 1000, end_ms: 2000, text: "Hi.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null, flags: [] }];
    const mock = render([itemRaw({ sub_source: "asr", rebuildable: true })], {
      "POST /api/library/items/i1/rebuild": () => json({ item: itemRaw({ sub_source: "asr", rebuildable: true, seg_count: 1 }), segments }),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("重新分句这条素材?")).toBeInTheDocument();
    expect(within(dialog).getByText(/不用自动转写额度/)).toBeInTheDocument();
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "重新分句" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已重新分句。"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/library/items/i1/rebuild")).toHaveLength(1);
    expect(screen.getByTestId("library-item-i1")).toHaveTextContent("1 句");
  });

  it("explains when an older item cannot be re-split", async () => {
    render([itemRaw({ sub_source: "asr", rebuildable: true })], {
      "POST /api/library/items/i1/rebuild": () => json({ error: "Item cannot be rebuilt" }, 409),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重新分句" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这条素材是更早的版本识别的,没有保留识别结果;请用「重新识别」。"));
  });

```

  4. `segment-list.test.tsx` 末尾追加:

```tsx
describe("SegmentList timing flags (plan v2 R-V14)", () => {
  it("marks a sentence whose timing may be off, and nothing else", () => {
    render({ segments: [{ ...SEGS[0], flags: ["pause"] }, { ...SEGS[1], flags: [] }, SEGS[2]] });
    expect(screen.getByTestId("segment-flag-0")).toHaveAccessibleName("这句的时间可能不准,可微调");
    expect(screen.queryByTestId("segment-flag-1")).toBeNull();
    expect(screen.queryByTestId("segment-flag-2")).toBeNull();
  });
});
```

  5. `use-media-player.test.ts`:导入行

```ts
  PAD_AFTER_MS, PlayerController, nextLoop, nextRate, pctFromRate, rateFromPct, segmentIndexAt, type Frames,
```

  换成

```ts
  PAD_AFTER_MS, PAD_BEFORE_MS, PlayerController, leadOf, nextLoop, nextRate, pctFromRate, rateFromPct, segmentIndexAt, tailOf,
  type Frames,
```

  既有用例

```ts
  it("loops one sentence forever 250 ms after its end", () => {
    const { media, c, at } = setup();
    c.setLoop("infinite");
    c.seekTo(0);
    at(3000 + PAD_AFTER_MS - 1);
    expect(media.seeks).toHaveLength(1);
    for (let i = 1; i <= 3; i += 1) {
      at(3000 + PAD_AFTER_MS);
```

  换成(第 0 句在 3000 结束、第 1 句 3200 开始,空隙 200 < 250,循环点移到 3200;其余不变)

```ts
  it("loops one sentence forever, at the next sentence's start when the gap is shorter than 250 ms (plan v2 R-V11)", () => {
    const { media, c, at } = setup();
    c.setLoop("infinite");
    c.seekTo(0);
    at(3199);
    expect(media.seeks).toHaveLength(1);
    for (let i = 1; i <= 3; i += 1) {
      at(3200);
```

  文件末尾追加:

```ts
describe("gap-aware pads (plan v2 R-V11)", () => {
  const segs = [
    { idx: 0, startMs: 1000, endMs: 2000 },
    { idx: 1, startMs: 2080, endMs: 3000 }, // 80 ms after the previous one
    { idx: 2, startMs: 3000, endMs: 4000 }, // touches the previous one (subtitles)
    { idx: 3, startMs: 9000, endMs: 9500 },
  ];

  it("never pre-rolls into the previous sentence or post-rolls into the next one when there is a gap", () => {
    expect(leadOf(segs, 0)).toBe(PAD_BEFORE_MS);
    expect(leadOf(segs, 1)).toBe(80);
    expect(tailOf(segs, 0)).toBe(80);
    expect(tailOf(segs, 3)).toBe(PAD_AFTER_MS);
    expect(leadOf(segs, 3)).toBe(PAD_BEFORE_MS); // a 5 s gap is longer than the pad
  });

  it("keeps the full pads for sentences that touch, as before", () => {
    expect(tailOf(segs, 1)).toBe(PAD_AFTER_MS);
    expect(leadOf(segs, 2)).toBe(PAD_BEFORE_MS);
  });
});
```

- [ ] **Step 2:跑一次确认红:** `cd web && yarn vitest run src/features/library/item-menu.test.tsx src/features/library/item-card.test.tsx src/features/library/library-list-page.test.tsx src/features/library/segment-list.test.tsx src/features/library/use-media-player.test.ts`。
- [ ] **Step 3:`item-menu.tsx`(Edit,三处):** 导入 `import { EllipsisIcon, RefreshCwIcon } from "lucide-react";` → `import { EllipsisIcon, RefreshCwIcon, ScissorsIcon } from "lucide-react";`;组件签名

```tsx
/** 卡片的 ⋯ 菜单(裁定 R-W1):目前只有「重新识别」。先关闭面板,再把条目交给调用方(调用方弹确认,不嵌套在面板里)。 */
export function ItemMenu({ item, onReprocess }: { item: LibraryItem; onReprocess(item: LibraryItem): void }) {
```

  换成

```tsx
/**
 * 卡片的 ⋯ 菜单(裁定 R-W1):「重新分句」(plan v2 R-V16:`item.rebuildable` 且有 `onRebuild`)与「重新识别」(有 `onReprocess` 时)。
 * 先关闭面板,再把条目交给调用方(调用方弹确认,不嵌套在面板里)。
 */
export function ItemMenu({ item, onReprocess, onRebuild }: {
  item: LibraryItem; onReprocess?(item: LibraryItem): void; onRebuild?(item: LibraryItem): void;
}) {
```

  面板里的 `<div className="space-y-1"> … </div>`(目前只有 `menu-reprocess` 一个按钮)整块换成:

```tsx
          <div className="space-y-1">
            {item.rebuildable && onRebuild ? (
              <button
                type="button" data-testid="menu-rebuild" className={ITEM}
                onClick={() => {
                  setOpen(false);
                  onRebuild(item);
                }}
              >
                <ScissorsIcon aria-hidden />
                <span className="min-w-0 flex-1">{t("web.library.card.rebuild")}</span>
              </button>
            ) : null}
            {onReprocess ? (
              <button
                type="button" data-testid="menu-reprocess" className={ITEM}
                onClick={() => {
                  setOpen(false);
                  onReprocess(item);
                }}
              >
                <RefreshCwIcon aria-hidden />
                <span className="min-w-0 flex-1">{t("web.library.card.reprocess")}</span>
              </button>
            ) : null}
          </div>
```

- [ ] **Step 4:`item-card.tsx`(Edit,三处):** `ItemCardHandlers` 里

```tsx
  /** 只在服务端开着自动转写时传(裁定 R-W1);没有就不显示 ⋯ 菜单 */
  onReprocess?(item: LibraryItem): void;
}
```

  换成

```tsx
  /** 只在服务端开着自动转写时传(裁定 R-W1) */
  onReprocess?(item: LibraryItem): void;
  /** plan v2 R-V16:重新分句;只对 `rebuildable` 的条目显示。两个都用不上就不显示 ⋯ 菜单 */
  onRebuild?(item: LibraryItem): void;
}
```

  `const canReprocess = ready && item?.subSource === "asr" && h.onReprocess !== undefined;` 之后加 `  const canRebuild = ready && item?.subSource === "asr" && item?.rebuildable === true && h.onRebuild !== undefined;`;

```tsx
          {item && canReprocess && h.onReprocess ? <ItemMenu item={item} onReprocess={h.onReprocess} /> : null}
```

  换成

```tsx
          {item && (canReprocess || canRebuild) ? (
            <ItemMenu item={item} onReprocess={canReprocess ? h.onReprocess : undefined} onRebuild={canRebuild ? h.onRebuild : undefined} />
          ) : null}
```

- [ ] **Step 5:`library-list-page.tsx`(Edit,五处):**
  1. 导入 `  putItemSubtitles, reprocessItem, retryItem, type LibraryItem,` → `  putItemSubtitles, rebuildItem, reprocessItem, retryItem, type LibraryItem,`
  2. `  const [pendingReprocess, setPendingReprocess] = useState<LibraryItem | null>(null);` 之后加 `  const [pendingRebuild, setPendingRebuild] = useState<LibraryItem | null>(null);`
  3. `  const onRetry = (item: LibraryItem) => {` 之前加

```tsx
  const confirmRebuild = async () => {
    const item = pendingRebuild;
    setPendingRebuild(null);
    if (!item) return;
    try {
      const { segments: _segments, ...next } = await rebuildItem(api, item.id);
      list.replace(next);
      toast.success(t("web.library.toast.rebuilt"));
    } catch (err) {
      fail(err);
    }
  };

```

  4. `    onReprocess: config.asr ? setPendingReprocess : undefined,` 之后加 `    onRebuild: setPendingRebuild,`
  5. 文件末尾 `    </LibraryRoot>` 那一行之前(重新识别那个 `AlertDialog` 之后)加

```tsx
      <AlertDialog open={!!pendingRebuild} onOpenChange={(open) => { if (!open) setPendingRebuild(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmRebuild.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">{t("web.library.confirmRebuild.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmRebuild()}>
              {t("web.library.confirmRebuild.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 6:`segment-list.tsx`(Edit):** 播放按钮里

```tsx
                    <span className="num text-[11px] leading-none">{formatDuration(seg.startMs)}</span>
                  </button>
```

  换成

```tsx
                    <span className="num text-[11px] leading-none">{formatDuration(seg.startMs)}</span>
                    {seg.flags?.length ? (
                      <span data-testid={`segment-flag-${seg.idx}`} role="img" aria-label={t("web.library.player.timingSuspect")}
                        title={t("web.library.player.timingSuspect")} className="mt-0.5 block h-1.5 w-1.5 rounded-full bg-[rgb(var(--amber))]" />
                    ) : null}
                  </button>
```

- [ ] **Step 7:`use-media-player.ts`(Edit,五处):**
  1. 文件顶部的注释 `/** 播放缓冲(spec §6.3 第 6 条):提前 150 ms 开始,延后 250 ms 才算这句结束。只在网页端,不进库。 */` 换成

```ts
/**
 * 播放缓冲(spec §6.3 第 6 条):提前 150 ms 开始,延后 250 ms 才算这句结束。只在网页端,不进库。
 * plan v2 R-V11:与相邻句之间有空隙时,缓冲最多用到这段空隙(不回放上一句的尾、不带进下一句的头);
 * 两句首尾相接(字幕常见)时仍用完整缓冲,与以前相同。
 */
```

  2. `const startOf = (seg: Seg) => Math.max(0, seg.startMs - PAD_BEFORE_MS) / 1000;` 换成

```ts
/** 提前量:有前一句且两句之间有空隙时不超过这段空隙。 */
export function leadOf(segs: readonly Seg[], i: number): number {
  const gap = i > 0 && segs[i - 1] ? segs[i].startMs - segs[i - 1].endMs : Number.POSITIVE_INFINITY;
  return gap > 0 && gap < PAD_BEFORE_MS ? gap : PAD_BEFORE_MS;
}

/** 延后量:有后一句且两句之间有空隙时不超过这段空隙。 */
export function tailOf(segs: readonly Seg[], i: number): number {
  const gap = segs[i + 1] ? segs[i + 1].startMs - segs[i].endMs : Number.POSITIVE_INFINITY;
  return gap > 0 && gap < PAD_AFTER_MS ? gap : PAD_AFTER_MS;
}

const startOf = (segs: readonly Seg[], i: number) => Math.max(0, segs[i].startMs - leadOf(segs, i)) / 1000;
```

  3. `tick` 里 `      if (ms < seg.endMs + PAD_AFTER_MS) return;` → `      if (ms < seg.endMs + tailOf(this.segs, index)) return;`
  4. `tick` 里

```ts
        this.patch({ repeats: repeats + 1 });
        this.media.currentTime = startOf(seg);
```

  换成

```ts
        this.patch({ repeats: repeats + 1 });
        this.media.currentTime = startOf(this.segs, index);
```

  5. `seekTo` 里

```ts
    this.patch({ index: idx, repeats: 0, once: false });
    this.media.currentTime = startOf(seg);
```

  换成

```ts
    this.patch({ index: idx, repeats: 0, once: false });
    this.media.currentTime = startOf(this.segs, idx);
```

- [ ] **Step 8:跑测试:** `cd web && yarn web:typecheck && yarn vitest run src/features/library src/architecture.test.ts`(写计划时在副本里实测 61 个文件 436 通过 1 跳过)。Radix `BottomSheet` 关闭与 `AlertDialog` 打开的先后在 jsdom 里已通过;若真实运行出现时序失败,用 `await waitFor(...)` 包住断言,不要改产品代码。
- [ ] **Step 9:提交:**

```
feat(web): re-split library sentences, mark doubtful sentence times, keep pads inside gaps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

# Task 13:文档、`CLAUDE.md`、未验证清单

- [ ] **Step 1:`server/app/CLAUDE.md`:** Pitfalls 里迁移那一行的 head 从 `0019` 改成 `0020`(只改这个数字)。
- [ ] **Step 2:`server/app/library/CLAUDE.md`(Edit,五处):**
  1. `asr_chunks.py` 那条的最后一行

```text
  `chunks.json` 版本 2(仍读 1)
```

  换成

```text
  `chunks.json` 版本 3(识别句带词 `[text, start_ms, end_ms]`,仍读 1、2);硬切处重叠(`plan_chunks(..., overlap_ms)`,只在有带时间的转写器时);
  `save_transcript` / `load_transcript`(条目目录里的 `transcript.json`)
```

  2. `quality.py` 那条末尾的「(阈值未用真实素材校准)」之后接上:

```text
;v2:`sentence_flags`(rate / pause / timing / estimated / seam,按本条素材的分布)+ `item_low_confidence`(被标记 >= 15%)
```

  3. `quality.py` 那条之后加三条:

```text
- `timeline.py` – 词级时间线(纯函数):识别句文字的词元对齐到词(`word` / `interp`),不可信块回落 v1 估算(`est`),硬切重叠的接缝去重
  (plan 2026-10-14-library-alignment-v2)
- `wordseg.py` – 词元 → 句子:`split_all` 定文字,长停顿断句、超长断在最大间隔、短句只在 <= 700 ms 的间隔内合并、带上限的首尾余量
- `sentences.py` – 总入口 `build(chunks, silences)`:有词走词路径(每句标记 + v2 检查),否则 v1 原样;流水线与「重新分句」共用
```

  4. Pitfalls 里

```text
- 识别服务返回的 `utterances[].text` 与转写一样永不进日志;`chunks.json` 在 `_tmp`,条目 ready 时随目录清掉。
```

  换成

```text
- 识别服务返回的 `utterances[].text` / `words[].text` 与转写一样永不进日志;`chunks.json` 在 `_tmp`,条目 ready 时随目录清掉;
  最终的识别结果另存为条目目录里的 `transcript.json`(含转写文字:随条目 / 用户删除,换字幕时删除并清 `rebuildable`,不进备份,
  不计入 `library_bytes`)。
```

  5. Pitfalls 末尾加:

```text
- 重新分句(`POST /items/{id}/rebuild`):`ready` + `sub_source=asr` + `rebuildable`;不排队、不扣额度;文字没变的句子保留译文;
  每句标记 `library_segments.flags` 在手动改时间时清空。
```

- [ ] **Step 3:`server/app/speech/CLAUDE.md`(Edit,四处):** `timed.py` 那条换成

```text
- `timed.py` – `Word` / `Utterance` (with `words`) / `TimedText` (recognition results with times; pure data, stdlib only)
```

  `asr_stream.py` 那条末尾接上:

```text
; `parse_words` keeps `utterances[].words`
```

  `asr.py` 那条末尾接上:

```text
 (`final_empty=True`: an empty stream answer means no speech, no fallback — library only)
```

  Tests 行的命令末尾加 ` tests/test_asr_words.py`。

- [ ] **Step 4:`server/app/routers/CLAUDE.md`:** `library` 那条里 `retry/cancel/reprocess (re-recognition of a ready auto-recognized item, allowance pre-check),` 之后接上:

```text
 rebuild (re-split sentences from the kept recognition, no allowance),
```

- [ ] **Step 5:`server/scripts/CLAUDE.md`:** What lives here 里 `asr_timing_probe.py` 那条之后加两条:

```text
- `asr_words_probe.py` – library alignment v2 Task 0: word times, alignment, cross-run jitter at a seam, v1 edge offsets (numbers only; `--yes` spends ~2x the clip; copy it next to `asr_timing_probe.py`)
- `library_alignment_eval.py` – one library item's sentence boundaries from its kept `transcript.json`: consistency report, gold template, scoring (numbers only; no network)
```

  Tests 行的命令末尾加 ` tests/test_asr_words_probe.py tests/test_library_alignment_eval.py`。

- [ ] **Step 6:`server/tests/CLAUDE.md`:** What lives here 里 `library_helpers.py` 那条之后加:

```text
- `library_words.py` – v2 helpers: word-timed utterances / chunks / tokens (`words_at`, `utt`, `chunk`, `tok`, `run`)
```

  `test_library_asr_timed.py / …` 那条之后加:

```text
- `test_library_chunks_v3.py` / `test_library_timeline.py` / `test_library_wordseg.py` / `test_library_quality_v2.py` / `test_library_sentences.py` – the word-time algorithm (pure); `test_library_words_pipeline.py` / `test_library_rebuild.py` – pipeline wiring, kept transcript, rebuild endpoint; `test_library_alignment_eval.py` – the evaluation script
```

- [ ] **Step 7:结果文档的完成情况与未验证。** 在 `docs/superpowers/plans/2026-10-14-library-alignment-v2-results.md` 末尾追加:

```markdown
## 完成情况与未验证

- 日期 / 基于提交:<日期> / <最后一个功能提交>;alembic head:0020
- 自动化(实际运行并通过):<逐个文件与条数>;未跑:服务端全量、网页全量、构建、E2E。

| 项 | 状态 |
|---|---|
| 词级时间的字段 / 基准 / 对齐率 / 抖动 | 见 Task 0 一节(或 PENDING) |
| 真实素材上的边界误差(金标准) | 未验证(没有金标准文件) |
| 目标:起点 p50 <= 120 / p95 <= 400 ms,终点 p50 <= 150 / p95 <= 500 ms,吃头吃尾 <= 5% | 未验证 |
| 余量 40 / 80 ms 与网页「不越过空隙」的听感 | 未验证 |
| v2 检查的误报率(稳健 z 3.5、15%) | 未验证 |
| 硬切重叠的真实额外费用 | 未验证(设计值:最坏 +4.9%) |
| 用户那条 vlog 重新识别后:12 句快语速不再报警、5 句低速句子消失或被标出 | 未验证 |
| `final_empty` 在真实服务上省掉的回落次数 | 未验证 |
| 迁移 0020 在 Postgres 上 | 未验证(只在 SQLite 上跑) |
| iOS Safari:⋯ 面板 → 确认框、可疑句圆点的大小与可点区域 | 未验证 |
```

- [ ] **Step 8:校验文档与代码一致:** `cd server && uv run pytest -q tests/test_architecture.py`;文档里提到的文件名逐个 `ls` 确认存在。
- [ ] **Step 9:提交:**

```
docs: library alignment v2 notes, CLAUDE.md updates and the unverified list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

**计划里的复选框只在合并且测试通过后才勾**(`docs/CLAUDE.md` 约定)。

---

# Task 14(关口):要不要服务端 VAD —— 只问,不做

**只在用户主动问起,或 Task 0 / 评估报告显示「大量块没有词级时间、被标 `estimated`」时才问;不要因为「更完整」而开工。**

- [ ] **Step 1:停,问用户(原文照此问,不要替用户决定):**

> 新算法用识别服务给的词时间定句边界,识别服务本身就起到了「人声检测」的作用,所以**我建议不引入 VAD**。VAD 只能改善两处:选块的切点(硬切已经用 2 s 重叠解决)和「识别服务没给词时间」时的估算(这些句子会被标成「时间可能不准」,可以重新识别)。候选:① silero-vad(onnx)+ `onnxruntime`:能区分人声与音乐,模型约 2 MB,但 `onnxruntime` 会让镜像大几十 MB(要实测);② `webrtcvad-wheels`:很小,但在持续背景音乐下基本无效;③ 不加依赖,用镜像里已有的 ffmpeg 找「相对最安静」的点当切点。要引入吗?选哪个?

- [ ] **Step 2:** 用户拒绝 → 把决定写进结果文档,本任务结束。用户同意 → 在本计划末尾追加 `## Addendum(日期)`:选定的候选、`pyproject.toml` / `uv.lock` 的改动(`uv lock` 需要联网,只改依赖行,`git diff --stat` 核对)、镜像体积实测、适配器 `app/library/vad.py` 的完整代码与先红后绿的测试、它在 `timeline.chunk_tokens`(只对 `est` 块)与 `plan_chunks`(切点)里的用法;依赖提交单独一个(`chore(server): add <chosen VAD> for speech-region detection`)。裁定以 Addendum 为准。

---

## 与 spec 的偏离(及理由)

1. **句子时间的来源(spec §6.3 第 3 条、§6.4 第 4 条):** 有词级时间时,句首句尾取词的起止,不再取「片段的 start / end」或按字符插值,也不吸附到静音中点。理由:设计 §1 第 1–3 条。字幕条目与没有词的识别不受影响(仍走 `segment.py`)。
2. **「两种输入共用一个分句器」(spec §6.3、E6):** 识别条目改走 `wordseg`;共用的仍是句子文字的规则(`split_all`),而不是整个分句器。理由:片段级的分句器无法利用词内部的时间。
3. **硬切重叠(spec §6.4 第 2 条):** 没有静音时,两块各多听 1 s(只在有词级时间时)。理由:设计 §3,费用最坏 +4.9%。
4. **识别结果不再是临时文件(spec §6.4 第 3 条):** 最终的块列表随条目保存为 `transcript.json`。理由:设计 §1 第 8 条与 §9;隐私处理见 R-V8。
5. **合理性检查(review spec §4.3.4 与 v1 R-Q1):** 词路径上不再用固定的字符速度阈值,改为按本条素材分布的稳健 z 分数 + 每句标记,条目只在 >= 15% 的句子被标记时才 `low_confidence`。理由:用户实测的快语速被误报。
6. **播放缓冲(spec §6.3 第 6 条):** 服务端写入的时间带 40 / 80 ms 的余量(不再是「原始」时间);网页缓冲在有空隙时不越过空隙。理由:识别服务的词终点偏早、固定缓冲会带进相邻句的词。
7. **回落语义(R3 / R25 的跟读库部分):** 跟读库的识别结果为空时不再回落到 chat / Whisper。理由:省钱、避免在音乐上编出文字;用户实测回落也为空。
8. **新增(spec 没有):** 迁移 `0020`(两列)、`POST /items/{id}/rebuild`、每句标记、评估脚本;「重新分句」保留文字没变的句子的译文(重新识别仍按 R-R5 全部替换)。

## 手动验证清单(未验证,由用户在部署后 / 真机勾选)

- [ ] Task 0:两段素材的探针输出已贴进结果文档,G1 结论为 A(或 B1 / B2 并已处理)。
- [ ] 对用户那条 15 分钟 vlog 点「重新识别」(花一次额度):第一句仍从约 27.4 s 开始;原来被标「超速」的句子不再导致整条「边界可能不准」;原来 4–5 字符 / 秒的几句被断开或收紧(逐句点播放听)。
- [ ] 在容器里对它跑 `library_alignment_eval.py report`:`now.violations` 全为 0、`now.cuts_inside_words` 为 0、`now.lead.p95` 与 `now.tail.p95` <= 100 ms;记录 `v1` 的同名数字作对比;`word_free_spans_s` 里每一段抽听确认是音乐 / 无人声。
- [ ] 跑 `sample --n 30`,用音频编辑器打开条目自己的媒体文件填好金标准,跑 `score`,把数字贴进结果文档(目标见设计 §10)。
- [ ] 点「重新分句」:立即完成、不占识别额度(管理端用量不变)、句子与「重新识别」后的一致;改过的句子被替换;译文对没变的句子还在。
- [ ] 旧条目(v2 之前识别的)⋯ 菜单里没有「重新分句」;换字幕后的条目也没有。
- [ ] 循环播放一句:开头不吃第一个音、结尾不吃最后一个音,也听不到下一句的第一个词(快语速段落里重点听)。
- [ ] 可疑句的小圆点在 360 px 宽的 iOS Safari 上可见、不挤压时间数字;用微调改了这句的时间后圆点消失。

## 已知限制 / 不做

- 精度上限是识别服务的词时间;不做本地强制对齐(spec §5 排除)。
- 不做批量「重新分句 / 重新识别」;旧条目要先「重新识别」一次(花额度)才能享受词路径与以后的免费重建。
- 不使用 `additions`;识别服务不给词级置信度,词的可信度由时间证据推出。
- 重叠窗口里两边都识别错时,只能标 `seam`,不能修正文字。
- 所有阈值、余量、目标都是写计划时的设定,**未用真实素材校准**;金标准存在后按 `score` 的带符号偏差调常量,再「重新分句」即可。
