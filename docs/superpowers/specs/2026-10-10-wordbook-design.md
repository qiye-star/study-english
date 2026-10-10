# 背单词(Wordbook)— 设计文档

- 日期:2026-10-10 · 状态:待产品负责人确认
- 范围:`server/`(新包 `app/wordbook/`、迁移 `0012_wordbook`、词典数据文件)、`web/`(新 feature `features/wordbook/`)、`admin/`(词书管理页)
- 实施计划:`docs/superpowers/plans/2026-10-10-wordbook.md` · 视觉稿:`docs/superpowers/design/wordbook-v1/mockup.html`
- 相关:`2026-10-04-mobile-web-practice-design.md` §3.5(词汇本、盒子法)、`2026-10-09-rank-and-rooms-design.md` §2–4(段位点、阶段练习、成就)、`2026-10-09-admin-console-v2-design.md`(设置注册表、提示词版本、计量、审计)、`docs/superpowers/design/redesign-v3/design-notes.md`(一色一义、玻璃)

---

## 0. 一页摘要

- **做什么**:在「练习」页加一张「背单词」大卡、在「我的 · 学习」加一行入口(**不加第五个底部 Tab**)。用户选一本词书(初中 / 高中 / 四级 / 六级 / 考研 / 托福 / SAT),每天默认学 **20 个新词**、复习上限 **100 个**;学新词 = 词卡(音标、释义、例句、朗读)→ 小测 → 进入复习;复习用五种**零成本题型**(选释义、看释义选词、拼写、听写、例句选词),干扰项来自同一本书;再加一个**按句拼写**练习(模式 A:目标词挖空,一词一条下划线,确定性判分出四种结果:正确 / 小笔误 / 词形不对 / 错误)。
- **数据**:KyleBing/english-vocabulary(BSD-3-Clause,提交 `c4c6c80879ff17d7025c28fb853a4991c8e6be6a`,2026-09-30)的 `full_line_jsonl/sentence/正序/` 七本书,**按产品负责人决定提交进 git**(每本一个文件,最大 9.8 MB,合计 45,661,272 字节),服务端**直接读文件**:启动后按书懒加载内存索引(词 → 行字节偏移),按需读行;实测七本书索引共 **7.70 MiB**。
- **实测发现**(§2):七本书 54,356 行里**只有 34,143 个不同词**(每本书是 2–3 份来源词表拼接,同一词出现 2–3 次且释义/例句不同),七本书并集 14,625 词;音标缺失 700 行,无例句 2,745 行,脏词头约 12 个(如 `a. 灵巧的， 熟练的`、`undersize d`、`AluminumAl`),例句里有 4,639 条 `(= …)` 释义夹注、7,449 条标点前空格。全部在读取时清洗、合并(§2.11)。
- **学习状态在数据库**:沿用 `vocabulary_items` 的 6 盒(1/2/4/7/15/30 天)算法,词书引入的新行 `source = 'wordbook:<book>'`;**不换 FSRS**。新增 `wordbook_enrollments`(选书与每日设置)、`wordbook_events`(答题流水,用于今日进度、段位点、统计)、`wordbook_explanations`(AI 讲解全站缓存)、`wordbook_reports` 与 `wordbook_hidden_sentences`(例句举报与屏蔽)。迁移 **`0012_wordbook`**(`alembic heads` 实测为 `0011`)。
- **段位**:复习照常产生 `vocab_review` 段位点(已有);新增 `word_learned`(学会一个新词 1 点)与 `spelling_set`(完成一组拼写 2 点),都计入每日上限;阶段练习新增类型 `words_learned`;成就新增「掌握 100 / 500 / 2000 词」与「学会 100 词」。
- **管理端**:设置注册表新增「背单词」分组(开关、启用的书、默认每日量、AI 讲解额度);词书页看每本书的文件校验、加载状态、学习人数与掌握数、例句举报;「重新加载词典」与「屏蔽例句」入审计。计量 feature `wordbook`。
- **开关**:`WORDBOOK_ENABLED` 默认关;有上游成本的 AI 讲解另有 `WORDBOOK_AI_ENABLED`(默认关;当前 LLM 上游返回 402 余额不足,功能必须优雅降级)。
- **分期**:第一阶段 = 上述完整可用功能(按句拼写用数据集自带例句,AI 讲解在子开关下);第二阶段 = AI 生成短文(失败回落到例句)、用词对话、单词发音评测、从 full 级数据抽取的同近义/同根/真题精简文件;第三阶段 = 摸底测试、学习统计、自定义词表;更远 = 房间/PWA 提醒、离线缓存。

## 1. 目标、非目标、原则

**目标**
1. 让中国学习者在手机上每天 10–20 分钟完成「学新词 + 复习 + 拼写」的闭环,与已有的跟读、对话、段位互相加分。
2. 零上游成本完成主流程:题目、干扰项、判分全部由数据和规则生成;朗读走已有 TTS(按字符计费,单词极短)。
3. 数据可追溯、可校验、可替换:文件带清单与校验和,脚本可重新下载并核对。

**非目标**(第一阶段不做):FSRS / SM-2 改造;词频排序(数据里没有频率);离线学习;自定义词表;第五个底部 Tab;把词典导入数据库;托管或转发第三方发音音频(数据里的 `ukspeech` 指向有道,不使用)。

**原则**
- 沿用分层:`app/wordbook/` 是与 `rank`、`rooms` 平级的新层,只导入 `core/models/providers/speech/services`;`rank` 不导入 `wordbook`(段位只读表)。
- 一个用户一个词一行(计划 R17 的应用层去重不变):词书遇到用户已有的词(查词加入的、别的书学过的)不重复建行,直接算作「已学」。
- 判分确定性:同样输入同样结果,不调用 LLM;AI 只做可选的「为什么」讲解与第二阶段的短文。
- 一色一义:青 = 词汇(词书主色调),蓝 = 主操作/进度/你,琥珀 = 提示与「接近正确」,绿 = 正确,中性灰 = 错误与次要(不用红色表示答错,红只用于挂断/退出/危险)。

## 2. 数据源调研(实测)

下载方式:GitHub API 列目录 + `raw.githubusercontent.com` 取文件,全部放在会话草稿目录,**未进仓库**。统计脚本用 Python 3.12 逐行解析。下文数字均为实测。

### 2.1 来源与许可

- 仓库:`https://github.com/KyleBing/english-vocabulary`,默认分支 `master`,提交 `c4c6c80879ff17d7025c28fb853a4991c8e6be6a`(2026-09-30T06:11:17Z)。
- 许可:BSD 3-Clause,`Copyright (c) 2022-2026, KyleBing`。再分发(含 Docker 镜像这种"二进制形式")必须保留版权声明、条件与免责声明 → 我们在数据目录放原文 `LICENSE`,仓库根放 `NOTICE`,网页「我的 → 关于 → 致谢与许可」页展示原文;不得用作者名义背书。
- 本项目根许可为 GPL-3.0,与 BSD-3 兼容。
- **风险**:数据由作者从公开词书/词典应用整理(full 级的 `wordId`/`ukspeech` 字段显示来自有道系词书),例句与译文的上游版权状况作者未声明。产品负责人已决定提交并使用;我们在 NOTICE 中如实注明来源,管理端可逐本停用(§9),出现权利主张时可整本下线(R-W12)。

### 2.2 目录与文件

仓库共有四种格式:`*.txt`(词条+释义)、`json/`(词条、短语、释义,7 本)、`full_line_jsonl/` 与 `full_line_tsv/`(每行一个词,`simple` / `sentence` / `full` 三种详略,`正序` 23 本 + `乱序` 9 本)。`正序` 的 23 本里包含本需求的 7 本(另有 GRE、GMAT、雅思、专四、专八、商务英语、人教/北师/外研社分册等 16 本,本期不用,见 §13)。`乱序` 是另一套词表(词数不同,如四级 4,901),不并入正序,**不用**。

本期使用 `full_line_jsonl/sentence/正序/<书名>.jsonl`(上游文件名为中文):

| id | 书 | 上游文件 | 字节 | 行(=词条) | 不同词 | 重复组(最多份数) | 来源分表(`bookId`,来自 full 级) | gzip -9 |
|---|---|---|---:|---:|---:|---:|---|---:|
| `junior` | 初中 | `初中.jsonl` | 4,068,095 | 3,223 | 1,987 | 1,234(3) | ChuZhong_2 1,420 · ChuZhong_3 1,803 | 1,288,878 |
| `senior` | 高中 | `高中.jsonl` | 6,428,647 | 6,008 | 3,743 | 2,263(3) | GaoZhong_2 3,668 · GaoZhong_3 2,340 | 2,014,586 |
| `cet4` | 四级 | `四级.jsonl` | 7,403,986 | 7,508 | 4,544 | 2,354(3) | CET4_1 1,162 · CET4_2 3,739 · CET4_3 2,607 | 2,285,638 |
| `cet6` | 六级 | `六级.jsonl` | 4,340,935 | 5,651 | 3,991 | 1,424(3) | CET6_1 1,228 · CET6_2 2,078 · CET6_3 2,345 | 1,371,562 |
| `kaoyan` | 考研 | `考研.jsonl` | 8,627,487 | 9,602 | 5,047 | 3,626(3) | KaoYan_1 1,341 · KaoYan_2 4,533 · KaoYan_3 3,728 | 2,722,465 |
| `toefl` | 托福 | `托福.jsonl` | 9,813,811 | 13,477 | 10,367 | 3,110(2) | TOEFL_2 9,213 · TOEFL_3 4,264 | 3,253,890 |
| `sat` | SAT | `SAT.jsonl` | 4,978,311 | 8,887 | 4,464 | 4,423(2) | SAT_2 4,423 · SAT_3 4,464 | 1,657,978 |
| | **合计** | | **45,661,272**(43.55 MiB) | **54,356** | **34,143**(并集 14,625) | | | **14,594,997** |

SHA-256(写入清单 `SOURCE.json`,脚本与测试据此校验):

```
junior  85e9465686372bed1a322b40211dcc021433ac4f0669bd9b14a8d2e5d7d52b92
senior  6941b02fb70b209c4f8162badeda9d439c7dae642d60385c6be4e0adf41245a8
cet4    e70511755f8da283ce25d37dd0662b0db35180aad0735c0767eedb37b8508e98
cet6    2c2f65773b7d272334efeb5ad302382b18f791c58bb238a6feb777a7c4b81f8b
kaoyan  a7160e81eb20f92a73382082fd40f2a1443f09b019a72ec4d5d88a44967d162c
toefl   a8bc63a7711faffd851c6b22c0ae499735f7cda2db7c5c81275a89ad51d8b8bd
sat     19315f8bbfcd7ee67afb2db74cd1df878c0f7196eae579526baf7cbe50f7fb55
```

上游 README 的「词条数量」(初中 3,223 … 合计 54,356)是**行数**,不是不同词数。

### 2.3 行格式(sentence 级)

每行一个 JSON 对象,七本书全部 54,356 行的键集合完全一致,且键顺序固定(`word` 永远是第一个键):

```json
{"word":"talk","us":"tɔk","uk":"tɔːk",
 "translations":[{"translation":"说话；谈话","type":"v"},{"translation":"交谈","type":"n"}],
 "phrases":[{"phrase":"talk about","translation":"谈论某事"}, ...],
 "sentences":[{"sentence":"I could hear Sarah and Andy talking in the next room.","translation":"我听到萨拉和安迪在隔壁讲话。"}, ...]}
```

| 字段 | 类型 | 说明(实测) |
|---|---|---|
| `word` | string | 词头;7 本 532 行含大写(专有名词、月份、`CD`);29 个多词词头(高中 3、SAT 26) |
| `us` / `uk` | string | 美/英音标,可能为空串;斜杠/方括号包裹 28 例;多读音用 `;` 或 `,` 分隔 2,982 例 |
| `translations[]` | `{translation, type}` | 69,751 条;`type` 为词性,写法杂乱(`n`、`vt`、`n&v`、`n & v`、`v / n`、`a&ad`、`modal verb`、缺失) |
| `phrases[]` | `{phrase, translation}` | 363,685 条;16,147 行为空数组 |
| `sentences[]` | `{sentence, translation}` | 92,115 条;每行 0–14 条 |

### 2.4 编码、BOM、行尾

七个文件:UTF-8、**无 BOM**、**纯 LF**(CRLF 0、孤立 CR 0)、以换行结尾、无空行、**0 行 JSON 解析失败**、最长一行 3,319 字节。63 行不是 NFC(含组合字符),读取时 NFC 规范化。

### 2.5 重复

- **书内重复是常态**:每本书由 2–3 份来源词表拼接而成(见 §2.2 `bookId`),同一词(小写比较)出现 2–3 次:初中 1,234 组、高中 2,263、四级 2,354、六级 1,424、考研 3,626、托福 3,110、SAT 4,423(SAT 几乎每个词两份)。逐字节完全相同的只有四级 2 组、考研 18 组;其余**释义、音标或例句不同**,例:`ability` 一份是「能力，能耐；才能」+ `ə'bɪləti`,另一份是「 能力， 本领； 才能， 才智」+ `əˈbɪlətɪ`。重复组里例句集合完全相同的占 790 / 1,495 / 1,687 / 580 / 2,508 / 2,003 / 2,874 组。
- 大小写不同的重复(`march`/`March` 之类):初中 4、高中 10、六级 1、考研 10、托福 10。
- **书间重叠**(不同词):托福 ∩ 考研 4,051、托福 ∩ 四级 3,549、考研 ∩ 四级 3,528、托福 ∩ 六级 3,071、高中 ∩ 四级 2,708、高中 ∩ 托福 2,704、考研 ∩ 六级 2,687、托福 ∩ SAT 2,225、初中 ∩ 高中 1,819;SAT 与初中只重叠 133。
- 文件顺序:去重后按首次出现的顺序,基本是第一份来源表的字母序(初中 `ability, able, about…`),托福第一份不是字母序(`back, significant, skill…`)。

### 2.6 脏数据

- 词头:`adj.`(初中)、`a.`(考研)、`a. 灵巧的， 熟练的`、`undersize d`、`sulfur disoxide`、`AluminumAl`、`PhosphorusP`、`Oxygen O`、`Iron Fe`(SAT)、`Rusia`(初中,拼错)、`Automatically`(六级,大写副词)。带点的词头:`Mr.`、`vs.`、`resumé`、`cliché`、`façade`(非 ASCII 字母 3 个)。
- 释义:17,664 条首尾有空白;17,581 条全角标点后多空格(`能力， 本领`);1,515 条带 `[法]`、`[美俚]` 等方括号领域标注;1,086 条夹英文。
- 词性缺失:初中 `Rusia`、高中 `handtruck`、六级 `misled`、托福 `fanwise`、SAT 至少 14 行(多为多词术语)。

### 2.7 例句质量

| 指标 | 数量 |
|---|---:|
| 例句总数 | 92,115 |
| 含 `(= …)` 英英夹注 | 4,639 |
| 标点前多空格(`talk , we`) | 7,449 |
| 以省略号开头(片段) | 1,842 |
| 少于 5 词 | 14,080 |
| 多于 30 词 | 487 |
| 英文句里夹中文(`非正式用语`) | 6 |
| 缺中文译文 | 61 |
| 含弯引号 `’ “ ”` | 10,781 |
| 含 NBSP / 细空格 | 10 |

合并重复后(按书内不同词计):每词平均例句 2.89(初中)/ 2.44 / 2.16 / 1.86 / 2.08 / 1.69 / 1.69(SAT),最多 16;**没有任何例句的词** 26 / 78 / 94 / 93 / 60 / 899 / 245 = 1,495(托福最多)。
例句与词头的匹配(单词词头 34,114 个,按书计,未做长度过滤):至少一句里**原形**出现 27,745;只以规则变形出现(`talking`)4,606;只以不规则/未识别形式出现 139;找不到 139;无例句 1,485。

**按 §2.11 的清洗规则实跑(计划 D1–D6 的代码,真实文件)**:每本书清洗合并后的键数 junior 1,985 · senior 3,743 · cet4 4,544 · cet6 3,991 · kaoyan 5,046 · toefl 10,367 · sat 4,457(合计 34,133;被丢弃的行 2 / 0 / 0 / 0 / 1 / 0 / 7);至少有一条可用例句(4–25 词、非片段、能定位目标词)的词 1,834 / 3,343 / 4,075 / 3,506 / 4,511 / 8,165 / 3,675,合计 29,109(85.3%),这就是按句拼写可出题的词;两种音标都没有的词 3 / 24 / 24 / 21 / 4 / 466 / 21(合计 563,托福最多)。

### 2.8 音标覆盖

`us` 为空 1,252 行、`uk` 为空 870 行、两者都空 700 行(托福 482 最多)。重音符号写法:每词首条 24,409 个用 ASCII 撇号 `'`、1,129 个用 IPA `ˈ`;显示前统一把 `'` 换成 `ˈ`、去掉包裹的 `/…/` 与 `[…]`。

### 2.9 full 级(第二阶段用)

七本书 full 级共 102,238,565 字节(97.50 MiB,最大托福 22.1 MB)。内容键覆盖(行数):`trans` 54,356(含英英释义 `tranOther`)、`syno` 同近义 50,012、`relWord` 同根 43,371、`remMethod` 记忆法 26,720、`realExamSentence` 真题例句 7,288、`exam` 真题选择题 **只有 1,217 行**(初中 122、四级 576、六级 519,其余四本 0)、`antos` 反义 1,204。按「每词最多 8 个同近义、10 个同根词(带 20 字释义)、1 条 ≤160 字英英释义、真题数」精简去重后,七本合计 **10,641,725 字节**(托福最大 3,020,199)。

### 2.10 内存与速度(本机实测,Windows 11、Python 3.12)

| 方案 | 七本合计常驻 | 说明 |
|---|---:|---|
| 只解析 `word` 前缀,dict[词 → 偏移元组] + 顺序表 | 6.42 MiB | 构建 679 ms |
| 同上的紧凑版(排序词串 + `array('I')`) | 2.03 MiB | 查找要二分,代码更复杂 |
| **采用**:整行解析一次,保留 dict[词 → 序号] + 偏移元组 + 词性位图 `array('B')` + 有例句标志 `array('B')` | **7.70 MiB** | 每本 166–483 ms(开 tracemalloc 时),七本 2.16 s |
| 对照:把七本书全部 `json.loads` 常驻 | 223.3 MiB | ≈4.2 KiB/行,不可取 |

随机读:托福 2,000 次「seek + readline + json.loads(含全部重复行)」共 36 ms(≈18 µs/词)。按计划 D3 的实现(线程中建索引、七本并发)实跑:七本全部加载 2.2 s。解析后的词卡 LRU 1,024 张按 4.2 KiB 上限估算 ≤ 4.3 MiB。**结论:全部书都加载后进程额外内存 < 12 MiB**。

### 2.11 清洗与合并规则(读取时执行,不改文件)

1. 行 → NFC;`word` 去首尾空白;键 = `services.vocabulary.normalize_word(word)`(与 `vocabulary_items.word` 一致:NFC、折叠排版撇号、压缩空白、小写)。
2. 丢弃词头:含中日韩字符;等于词性缩写(`a.`、`adj.`、`n.`、`v.`、`adv.`);在 `DENYLIST`(`undersize d`、`sulfur disoxide`、`aluminumal`、`phosphorusp`、`oxygen o`、`iron fe`、`rusia`)。丢弃数写进管理端统计。
3. 同键多行合并成一张词卡:显示词头取出现最多的大小写写法(平手取第一次);`us`/`uk` 取第一个非空并规范化(§2.8);释义按 `(词性, 规范化文本)` 去重保序,最多 6 条;短语去重保序最多 10 条;例句按规范化英文去重保序最多 6 条。
4. 释义文本:去首尾空白,全角 `，；：。` 后的空白删掉,保留 `[法]` 这类标注。
5. 词性:`vt`/`vi`/`v` → `v`;`a` → `adj`;`ad` → `adv`;`n&v`、`n & v`、`v / n` 拆成多个;缺失 → `other`。位图:n=1、v=2、adj=4、adv=8、其他=16。显示保留原写法(`vt.`)。
6. 例句清洗:删 `(= …)` 夹注;删标点前空白;弯引号保留显示、匹配时折叠;丢弃以省略号开头、含中日韩字符、少于 4 词或多于 25 词、或找不到目标词(原形或变形)的例句;被管理端屏蔽的例句(`wordbook_hidden_sentences`)不再出现。例句 id = 清洗后英文的 SHA-1 前 16 位 hex。
7. 多词词头(`used to`、`carbon dioxide`)可学可选择题,拼写题按词拆成连续空;带点或非 ASCII 字母的词头(`Mr.`、`façade`)不出拼写/听写题。

## 3. 文件布局与入库

```
server/dictionaries/                       ← 新目录(server/.gitignore 只忽略 data/,不受影响)
  CLAUDE.md
  kylebing-english-vocabulary/
    CLAUDE.md
    LICENSE                                ← 上游 BSD-3 原文,逐字
    SOURCE.json                            ← 清单:仓库、提交、每本书的上游路径/本地文件/字节/sha256/行数/不同词数
    junior.jsonl  senior.jsonl  cet4.jsonl  cet6.jsonl  kaoyan.jsonl  toefl.jsonl  sat.jsonl
    (第二阶段)extras/<id>.extra.jsonl     ← 从 full 级精简派生,见 §12.4
server/scripts/wordbook_data.py            ← download / verify / derive(第二阶段)子命令,只用标准库
NOTICE                                     ← 仓库根:第三方数据声明(本数据 + 后续新增)
```

- 本地文件名用 ASCII id(避免 Windows/Docker/`core.quotepath` 的中文路径问题);上游中文路径记在 `SOURCE.json`。
- `.gitattributes` 追加:`server/dictionaries/**/*.jsonl binary`(= `-text -diff -merge`:Windows `core.autocrlf` 不改字节,校验和稳定;`git diff` 不刷屏)与 `server/dictionaries/**/*.jsonl linguist-vendored`。
- 每个文件 < 10 MB,远低于 GitHub 单文件 50 MB 软上限与 100 MB 硬上限;**不用 Git LFS**。
- `server/scripts/wordbook_data.py download` 按 `SOURCE.json` 的固定提交下载到目标目录并校验 sha256;`verify` 只校验(CI/测试用同一函数);更新数据 = 改清单里的提交与校验和 → `download` → 单独一个提交(`chore(server): update wordbook data to <sha>`)。
- `server/tests/test_wordbook_data_files.py` 校验已提交文件的字节数与 sha256(七个文件哈希约 0.2 s)。
- Docker:`server/Dockerfile` 最终阶段 `COPY server/dictionaries /app/dictionaries`(运行时路径 `/app/dictionaries/...`,与 `app/` 同级);`server/Dockerfile.dockerignore` 白名单加 `!server/dictionaries`。镜像增大约 45.7 MB(第二阶段 +10.6 MB)。
- 路径解析:`Settings.wordbook_data_dir`(env-only,默认空)→ 空时用 `Path(app/__init__.py).parents[1] / "dictionaries" / "kylebing-english-vocabulary"`,开发(`server/app` → `server/dictionaries`)与容器(`/app/app` → `/app/dictionaries`)同一条规则。
- **仓库体积影响**:当前对象包 278.93 MiB;新增数据压缩后约 14.6 MB(+5.2%),每次数据更新再增约同量(增量压缩可能更少)。克隆、CI 缓存与 Docker 构建上下文相应变大;`git clone --filter=blob:none` 可缓解。

## 4. 运行时词典索引(`app/wordbook/index.py`)

- `DictionaryStore(data_dir, cache_size=1024)` 挂在 `app.state.wordbook_dict`(`dictionary(app)` 惰性创建)。**按书懒加载**:第一次访问某本书时在线程里(`asyncio.to_thread`)整文件扫一遍,建 `BookIndex`;同一本书的并发首访用 `asyncio.Lock` 合并。启用的书列表变化不触发加载。
- `BookIndex`:`keys`(去重后按书序的键元组)、`ordinal: dict[str,int]`、`offsets: tuple[tuple[int,...],...]`(每个键的全部行偏移)、`pos_mask: array('B')`、`has_example: array('B')`(至少一条清洗后可用例句)、`size`、`mtime_ns`、`dropped`(被规则丢弃的词头数)、`built_ms`。
- 读卡:`card(book, key)` → LRU 命中直接返回;否则在线程里按偏移 `seek + readline`,解析全部重复行,合并为 `WordCard` 放进 LRU。批量 `cards(book, keys)` 一次线程调用读多行。
- 重新加载:不做文件监听;管理端「重新加载词典」(`reload()`,入审计)丢弃索引和 LRU,下一次访问重建。每次建索引记录 `size`/`mtime_ns`,管理端显示「文件已变化,需重新加载」。
- 失败:文件缺失或校验失败 → 该书在 `/api/wordbook/config` 标 `available:false`,接口对该书返回 503 `{"error":"Wordbook data unavailable"}`;诊断(doctor)列出原因。启动不因数据缺失失败。
- 多进程:当前单 worker;多 worker 时每个进程各自懒加载(内存 × worker 数)。

## 5. 数据模型与迁移 `0012_wordbook`

`alembic heads` 实测 `0011 (head)` → `revision = "0012"`、`down_revision = "0011"`(实施时再跑一次,若已被其它计划占用则顺延并在计划里加 Addendum)。SQLite 走 batch,Postgres 安全;`test_migrations.py` 加往返测试。

**`vocabulary_items`**:结构不变。`source` 新取值 `wordbook:<book>`(最长 `wordbook:kaoyan` 15 字符,`String(16)` 够用)。规则:
- 词书新建的行:`source='wordbook:<book>'`、`meaning` = 前 3 条释义拼接(≤ 1000)、`example` = 首条可用例句(≤ 500)。
- 词书遇到用户已有的词(任何来源)不建行,视为「已学」。
- `max_vocab_items`(默认 2000)**只统计非词书行**(`source NOT LIKE 'wordbook:%'`);词书行上限是书的词数。
- `GET /api/vocabulary` 新增 `scope=mine|all`,**默认 `mine`**(不含词书行),生词本页面行为不变;复习两边共享同一行,在任一处复习都会更新同一个盒子。

**新表**

| 表 | 列 | 约束 / 索引 |
|---|---|---|
| `wordbook_enrollments` | `user_id`(FK users CASCADE)、`book_id` String(16)、`status` String(8)(`active`/`paused`)、`order_mode` String(8)(`shuffle`/`book`)、`seed` Integer、`cursor` Integer(在书序排列中的下一个位置)、`daily_new` Integer、`review_cap` Integer、`started_at`、`updated_at` | PK `(user_id, book_id)`;同一用户最多一本 `active`(应用层保证) |
| `wordbook_events` | `id` Integer PK、`user_id`(FK CASCADE)、`book_id` String(16)、`kind` String(12)(`learn`/`review`/`practice`/`blank`/`spell_set`)、`word` String(100)、`item_id` String(36) 可空、`qtype` String(12) 可空、`outcome` String(12)、`credit` Integer(0–100)、`day` String(10)(用户本地日)、`created_at` | 索引 `(user_id, created_at)`、`(user_id, day)`、`(book_id, kind)` |
| `wordbook_explanations` | `word` String(100) PK、`body` Text、`model` String(100)、`prompt_version` Integer 可空、`created_at` | 全站共享缓存,一个词一条 |
| `wordbook_reports` | `id` Integer PK、`user_id`(FK SET NULL,可空)、`book_id`、`word`、`sentence_id` String(16)、`kind` String(12)(`sentence`;第二阶段 `passage`)、`reason` String(16)(`wrong`/`offensive`/`other`)、`status` String(12)(`open`/`hidden`/`dismissed`)、`created_at` | 索引 `(status, created_at)` |
| `wordbook_hidden_sentences` | `sentence_id` String(16) PK、`book_id`、`hidden_by` String(64)、`created_at` | 进程启动与审计写入后刷新到内存集合 |

答题流水的量:每人每天约 20 新词 + 100 复习 + 20 拼写空 ≈ 150 行;单机自托管可接受,保留期第一阶段不设(第三阶段统计要用历史)。

## 6. 学习算法

### 6.1 盒子法(不变)与本功能的映射

`next_review(box, grade, now)`(`app/services/vocabulary.py`)不变:`forgot` → 盒 0、明天;`hard` → 盒不变、间隔减半;`good` → 盒 +1、新盒间隔。

| 事件 | 盒子变化 |
|---|---|
| 学新词:小测一次答对 | 新建行 盒 0、`due_at` = 明天(`next_review(0, good)` 再固定回盒 0:新词至少隔天复习一次) |
| 学新词:小测答错 | 新建行 盒 0、明天;本轮末尾重学重测直到答对(重测只记 `practice`) |
| 学新词:点「我认识」 | 新建行 盒 2、`due_at` = 4 天后(结果 `known`) |
| 复习题,该词到期 | 第一次作答决定:正确 → `good`;小笔误/词形不对/用了首字母提示/第二次才对 → `hard`;错误 → `forgot`;用已有的乐观并发条件 `reps == seen_reps` 写入 |
| 作答时该词未到期(同一轮再次出现、拼写练习里的今日新词) | 正确/接近 → 不改盒子(`practice`);**错误 → `forgot`**(有证据忘了,R-W5) |

**已学** = 用户 `vocabulary_items` 里有该词(任何来源)。**已掌握** = 已学且 `box ≥ 4`(间隔 ≥ 15 天,至少 4 次成功复习)。**剩余** = 书的不同词数 − 已学。

### 6.2 每日计划(`plan.py`)

- 本地日:请求带 `tz_offset_minutes`(与段位一致,范围 −840…840);计数用 `wordbook_events.day`。
- `new_target = enrollment.daily_new`(默认 20,5–100);`new_done` = 今日 `learn` 事件数(按词去重);`new_left = max(0, new_target − new_done)`。
- `review_due` = 本书已学词中 `due_at ≤ now` 的数量(本书 = 键在书索引里);`review_done` = 今日 `review` 事件数;`review_left = min(review_due, max(0, review_cap − review_done))`(上限默认 100,20–500)。
- **积压保护**:`review_due > review_cap` 时 `new_left = min(new_left, 5)`,首页提示「复习积压,今天少学新词」。
- 顺序:先复习后新词(首页主按钮按此给出「开始复习 34」或「学新词 20」);拼写练习独立入口。
- 新词选择:`order_mode = shuffle`(默认)用 `seed`(选书时随机)对书序做确定性洗牌;`book` 用书序。从 `cursor` 往后取,跳过已学的词;**只有新词真正被学(建行)时 `cursor` 才前进**,中途退出下次仍是同一批。
- 明日预测:`due_at < 明天本地日结束` 的本书已学词数。

### 6.3 学新词流程

一轮 5 个词(`/learn/batch`,最多 10):逐个看词卡 → 全部看完后对这 5 个做小测(题型 `meaning` 选释义)→ 答错的词回到队尾再看词卡再测 → 一轮结束显示小结,可继续下一轮直到 `new_left = 0`。
词卡:词头(大)、美/英音标与朗读键(TTS)、释义(词性 + 文本,最多 4 条)、1 条例句(目标词高亮为琥珀色,可展开译文,可朗读)、短语(折叠,最多 5 条)、「我认识」次按钮、「下一个」主按钮。

### 6.4 题型(零成本)

| qtype | 题面 | 作答 | 判分 | 适用 |
|---|---|---|---|---|
| `meaning` | 英文词 + 音标(可朗读) | 4 选 1 中文释义 | 选项文本 == 正确释义行 | 盒 0–1、新词小测 |
| `word` | 中文释义行 | 4 选 1 英文词 | == 词头 | 盒 0–2 |
| `cloze` | 例句(目标处为空)+ 译文 | 4 选 1 英文词 | == 词头 | 盒 1–3,词有原形例句 |
| `dictation` | 只播放读音(TTS),可重播 | 键入单词 | `grade_blank` | 盒 2+,单词词头且 ASCII |
| `spell` | 中文释义 + 词长提示可选 | 键入单词 | `grade_blank` | 盒 3+,同上 |

选择:`pick_qtype(box, card, rng)` 在适用集合里按 `rng = Random(hash(user_id, key, reps))` 选,同一词同一复习次数结果稳定。释义行 = 前两条释义 `pos. 文本` 用「；」连接,截到 24 字。

### 6.5 干扰项(同一本书)

1. 候选:按 `rng` 从书的键里抽 24 个,要求 `pos_mask` 与目标有交集(词性相同)、不是目标、与目标没有共同 5 字母前缀(避免同根)、不是目标的变形或原形。
2. 读出候选词卡(批量),去掉释义与目标**有共同释义片段**的(按「，；、」切分后任一片段相同),去掉两词相等或释义行相同的。
3. `word`/`cloze` 题优先词长差 ≤ 2 的候选(更难区分);`meaning` 题随机。取 3 个;不足时放宽词性再抽一次;仍不足(书极小)就用全书随机。
4. 选项顺序用 `rng` 打乱。

### 6.6 按句拼写 · 模式 A(目标词挖空)

**组题**(第一阶段只用数据集例句):
- 目标词池:今日学过的新词 + 本书到期词(优先最近答错的)+ 盒 ≤ 3 的词;排除带点/非 ASCII 的词头。一组 3–6 个目标词(默认 5),一次最多 4 组。
- 每个目标词选一条例句(`best_example`):清洗后可用、目标以原形出现优先,其次规则变形;长度 8–16 词优先;同一组内句子不重复。找不到的词换下一个。
- 一组 = 3–6 句(第一阶段这是"句组",彼此无关;第二阶段才是连贯短文)。每句只把目标词挖成空;多词词头拆成连续的空,每词一空;**只挖目标词**,其余词照常显示。每句的中文译文默认隐藏,可点「看译文」。
- 空的答案 = 句中的实际词形(`talking`),判分时同时知道原形(`talk`)。

**输入**(网页,§11.5):一条下划线一个空,默认不显示字母数(设置「显示字母数」后显示下划线格);打字进当前空,**空格**跳到下一个空,**空的空上按退格**回到上一个空,**回车**提交;点任意空可跳过去。只用一个隐藏的 `<input>` 管理全部空(移动端键盘稳定),`autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"`、`enterkeyhint="done"`。
提示:「首字母」(该空得分减半)、「听这句/听全组」(TTS,不扣分)、「看译文」(不扣分)。

**判分**(`grading.grade_blank(expected_form, lemma, typed, hinted)`,确定性):
1. 规范化:NFC、去首尾空白、折叠弯撇号、小写(专有名词也不区分大小写,解释里给出正确大小写)。
2. 相等 → **正确**(credit 100)。
3. 否则 typed ∈ 原形的变形集合(或 typed 的原形集合含 lemma),且 typed ≠ 期望形式 → **词形不对**(credit 50),例:应填 `talking` 写了 `talked`/`talk`。
4. 否则编辑距离 ≤ 上限(期望长度 ≤ 4:1;否则 2)→ **小笔误**(credit 50),返回逐字母对齐(`eq`/`sub`/`ins`/`del`)供高亮。
5. 否则 → **错误**(credit 0),也返回对齐(只在长度差不大时高亮,否则只显示正确拼写)。
6. 用了首字母提示 → credit 减半(正确 50、接近 25)。
多词词头:每个空独立判分,词的结果取最差的空。

**变形与原形**(`textnorm.py`):规则变形(`s/es/ies`、`ed/d/ied`、辅音双写 + `ed/ing`、去 `e` + `ing`、`er/est`、`ly`)+ 内置不规则表(139 个常见不规则动词三形、不规则复数与比较级,如 `go/went/gone`、`child/children`;`be` 只用不规则形式,避免 `bed`/`best` 被当成它的变形)。反向求原形:逆规则生成候选,再用七本书的并集键(14,625)与不规则表验证。只用于判「词形不对」,不会把真正拼错判成变形(变形结果必须本身是合法形式)。

**结果与讲解**:每个空显示结果徽标(图标 + 文字,不只靠颜色)、你的输入(笔误时按字母高亮差异)、正确拼写、音标与朗读、词性与释义、例句、错误类型说明(「少了一个字母 r」「应为现在分词 talking」)。每词一个「为什么?」按钮 → §6.7。提交后 `aria-live="polite"` 只播报一次总分;组内 credit 均值 ≥ 60 计一次 `spell_set`。
**进入盒子**:每个目标词按 §6.1(到期 → 按结果改盒;未到期 → 只有错误才 `forgot`)。

### 6.7 AI「为什么」讲解(子开关 `WORDBOOK_AI_ENABLED`,第一阶段)

- 按需:用户点「为什么?」才请求;**一个词一条,全站共享**(`wordbook_explanations`,键 = 规范化词),不含用户输入,所以可复用。
- 提示词 `wordbook.explain`(注册进 `app/services/prompts.py`,管理端可版本化),占位符 `{word}`、`{meanings}`、`{example}`,边界标签 `<word>`…`</word>`;输出 ≤ 300 字中文:用法、常见混淆、拼写记忆点。`max_tokens` 400,温度 0.3。
- 成本:缓存命中免费且不计次;未命中先扣全站每日额度 `WORDBOOK_AI_GLOBAL_DAILY`(默认 200)与每人每日 `WORDBOOK_AI_DAILY_PER_USER`(默认 20,可按用户覆盖),上游失败退还;计量 feature `wordbook`。
- 降级:开关关、未配置 LLM、上游 402/429/5xx/超时 → 503 `{"error":"AI explanation unavailable"}`,界面显示「AI 讲解暂不可用」,数据讲解照常。日志只记状态码与词长,不记正文。

### 6.8 模式 B(整段听写,以后)

每个词都是空的整句/整段听写:复用同一输入引擎与判分;需要连贯短文(第二阶段 AI 短文)才有意义;不在本期。

## 7. API(`/api/wordbook/*`,`app/routers/wordbook.py`)

全部需要登录。`WORDBOOK_ENABLED=false` 时只有 `GET /config` 返回 `{"enabled": false}`,其余 404 `{"error":"Wordbook is disabled"}`。错误统一 `{"error": "..."}`。书 id 不在启用列表 → 404 `Book not found`;数据不可用 → 503 `Wordbook data unavailable`。响应为 snake_case(网页客户端自动转 camelCase)。

| 方法 路径 | 请求 | 响应(要点) |
|---|---|---|
| `GET /config` | — | `{enabled, ai_available, defaults:{daily_new, review_cap}, books:[{id,title_zh,title_en,level,words,available}]}` |
| `GET /books` | — | `{books:[{id,title_zh,title_en,level,words,learned,mastered,enrolled,active}]}` |
| `PUT /enrollment` | `{book_id, daily_new?, review_cap?, order_mode?}` | `EnrollmentOut`;设为 active,其它暂停;再次选同一本只更新设置,不重置进度 |
| `GET /today?tz_offset_minutes=` | — | `{enrollment, book, plan:{new_target,new_done,new_left,review_due,review_done,review_left,backlog_guard}, progress:{words,learned,mastered,remaining}, tomorrow_due}`;没选书时 `enrollment:null` |
| `POST /learn/batch` | `{size?:1–10=5}` | `{book_id, cards:[CardOut], quiz:[QuestionOut]}`(不建行) |
| `POST /review/batch` | `{size?:1–20=20}` | `{book_id, questions:[QuestionOut], cards:{key:CardOut}}`(到期词,最久过期在前) |
| `POST /answers` | `{book_id, key, mode:"learn"|"review", qtype, choice?, typed?, hinted?, known?, tz_offset_minutes}` | `{correct, outcome, grade, expected, diff?, item:{box,due_at}|null, applied}` |
| `POST /spell/sets` | `{count?:1–4=2, size?:3–6=5}` | `{book_id, sets:[{set_id, lines:[{key, sentence_id, segments:[{t:"text",v}|{t:"blank",i,len,form}], zh}]}]}`(`form` = 句中实际词形,只供首字母提示与「听这句」;集成裁定 Z-c) |
| `POST /spell/submit` | `{book_id, set_id, lines:[{key, sentence_id, answers:[{typed, hinted}]}], tz_offset_minutes}` | `{credit, counted, words:[{key, outcome, credit, blanks:[BlankOut], card:CardOut, item}]}` |
| `GET /cards/{book_id}/{key}` | — | `CardOut` |
| `POST /explain` | `{key}` | `{key, text, cached}`;不可用 503 |
| `POST /reports` | `{book_id, key, sentence_id, reason}` | `{id}`;每人每日 20 条 |

`CardOut = {key, word, us, uk, senses:[{pos,text}], phrases:[{en,zh}], examples:[{id,en,zh}]}`;`QuestionOut = {key, qtype, prompt:{word?,us?,meaning?,sentence?,zh?}, options:[str]|null, length:int|null}`;`BlankOut = {i, outcome, credit, typed, expected, diff:[{op,a,b}]}`。

**无状态判分**:服务端不存题目。`/answers` 用 `(book_id, key, qtype)` 重新读词卡判分;`/spell/submit` 用 `(key, sentence_id)` 重新定位句子与空(词卡里没有该句 → 422 `Sentence changed`)。客户端能看到选项,作弊空间与现状相同;段位点有每日上限。
**防滥用**:每人每日最多 3,000 次作答(`daily_usage` 范围 `wordbook_answers`,超出 429 `Daily answer limit reached`)。不走 `limited_user`(那是 AI 限流);`/explain` 走 `limited_user`。

## 8. 段位联动(`app/rank/*`)

- `points.POINTS` 增加 `word_learned: 1`、`spelling_set: 2`,两者加入 `CAPPED`(与 `vocab_review` 等共享每日 60 点上限,不能靠刷词冲段)。`PointsRule` 增加同名字段,带默认值(已发布的旧规则 JSON 仍能解析)。
- `ledger._collect` 增加来源:`wordbook_events.kind='learn'` → `word_learned`(ref `wl:<id>`),`kind='spell_set'` → `spelling_set`(ref `ws:<id>`)。复习照旧经 `vocabulary_items.last_reviewed_at` 产生 `vocab_review`。
- 阶段练习新增类型 `words_learned`(统计 `word_learned` 事件);`StageTaskRule.kind` 增加该值;**默认阶段练习不变**(开关默认关,若默认含它会挡住晋级)。管理端发布含 `words_learned` 的规则时,若 `WORDBOOK_ENABLED=false` 拒绝发布(错误码 `stage_tasks:wordbook_disabled`)。
- 成就(组 `vocab`,青色):`words_learned_100`「百词入门 · 学会 100 个新词」、`words_mastered_100`「小有积累 · 掌握 100 词」、`words_mastered_500`「词汇达人 · 掌握 500 词」、`words_mastered_2000`「博闻强识 · 掌握 2000 词」。快照新增 `words_learned`(learn 事件数)与 `words_mastered`(全部 `vocabulary_items` 中 `box ≥ 4` 的行,不限来源)。图标 `book`(网页映射到 `LibraryBigIcon`)。
- 段位关闭时词书照常工作,只是不产生段位反馈;拼写/学习小结里「+N 段位点」只在 `/api/rank/config.enabled` 时显示(且为估算,以 `/rank/me` 为准)。

## 9. 管理端

- **设置注册表**新增分组 `("wordbook", "背单词")`,条目见 §10;`wordbook_enabled`、`wordbook_ai_enabled` 放在「功能开关」分组(后者 `danger="打开后会产生上游费用"`)。启用/停用某本书 = 改 `wordbook_books`(经 `settings_service.save`,自动审计、热生效)。停用的书:不出现在选书页;已选该书的用户首页显示「该词书已停用」并引导换书;学习记录保留。
- **词书页**(`admin/src/features/wordbook/`,路由 `/wordbook`,导航「用户与内容」组):每本书一行 —— 启用开关、文件字节与校验(✓/✗)、行数/不同词/丢弃词头数、是否已加载与构建耗时、选此书人数、近 7 天学习人数、累计学会词数、掌握词数、待处理举报数;顶部 AI 讲解今日调用/上限与缓存条数;按钮「重新加载词典」(operator,理由,审计 `wordbook.reload`)。例句举报列表:书、词、句子、原因、次数;操作「屏蔽此句」(审计 `wordbook.sentence.hide`)/「忽略」(`wordbook.report.dismiss`)。
- **提示词**:`wordbook.explain`(第一阶段)、`wordbook.passage`、`wordbook.chat_judge`(第二阶段)注册进 `PROMPTS`,管理端「提示词」页零改动可见、可试运行。
- **计量**:`FEATURE_PREFIXES` 增加 `("/api/wordbook", "wordbook")`;管理端用量页的功能名映射加「背单词」。朗读走 `/api/ai/audio/speech`,计入 `audio`(与跟读相同,单词极短)。
- **配额**:`QUOTA_KEYS` 增加 `wordbook_ai_daily_per_user`;用户详情的配额覆盖表单显示标签「每人每日 AI 讲解次数」。
- **诊断**:开关打开但数据目录缺失/校验失败 → 列出问题;AI 子开关打开但未配置 LLM → 提示。
- 管理端只做桌面(R-7)。

## 10. 设置与开关

| 键 | 类型 / 默认 | 组 | 生效 | 说明 |
|---|---|---|---|---|
| `wordbook_enabled` | bool / false | features | 热 | 关:接口 404(config 除外),入口隐藏,数据保留 |
| `wordbook_ai_enabled` | bool / false | features | 热 | AI 讲解(第二阶段含短文与用词对话);危险:产生费用 |
| `wordbook_books` | csv / `junior,senior,cet4,cet6,kaoyan,toefl,sat` | wordbook | 热 | 启用的书;未知 id 校验失败 |
| `wordbook_daily_new` | int / 20(5–100) | wordbook | 热 | 新选书的默认每日新词 |
| `wordbook_review_cap` | int / 100(20–500) | wordbook | 热 | 新选书的默认每日复习上限 |
| `wordbook_ai_model` | str / 空 = `default_llm_model` | wordbook | 热 | |
| `wordbook_ai_global_daily` | int / 200(0–100000) | wordbook | 热 | 全站每日未命中缓存的 AI 调用;危险:费用 |
| `wordbook_ai_daily_per_user` | int / 20(0–1000) | wordbook | 热 | 可按用户覆盖 |
| `wordbook_data_dir` | str / 空 | system(env-only) | 重启 | 词典目录 |

派生属性:`wordbook_ai_available = wordbook_enabled and wordbook_ai_enabled and bool(upstream_llm_base_url)`;`resolved_wordbook_ai_model`。

## 11. 网页

### 11.1 入口

- **练习页**:段位卡下方一张「背单词」大卡(`WordbookCard`,`useWordbookEnabled()` 为假时不渲染)。未选书:青色书本图标 + 「选一本词书,每天 20 个新词」+ 主按钮「选择词书」。已选书:书名徽标、今日进度环(新词 x/20)、两行计数(待复习 n、已掌握 m / 总词数)、主按钮(「开始复习 n」或「学新词 k」或「今日完成」)与次按钮「拼写练习」。
- **我的 → 学习**:「背单词」行(副标题:书名 · 已掌握 m 词),在「词汇本」行下方;开关关时不显示。

### 11.2 路由与页面(`features/wordbook/`)

| 路由 | 页面 |
|---|---|
| `/wordbook` | 首页:书卡(书名、总进度条:已掌握/已学/剩余)、今日计划(新词环 + 复习计数 + 明日预测)、三个动作(复习 / 学新词 / 拼写)、每日设置入口 |
| `/wordbook/books` | 选书:7 本卡片(书名、级别、词数、已学/掌握、当前标记),每日新词与复习上限的分段选择(10/20/30/50,复习 50/100/200),顺序「乱序/书序」 |
| `/wordbook/learn` | 学新词:词卡 → 小测 → 小结 |
| `/wordbook/review` | 复习:混合题型 → 小结 |
| `/wordbook/spell` | 按句拼写:组 → 提交 → 结果与讲解 → 下一组 → 小结 |

小结页(会话内,不单独路由):本次学/复习/拼写数量、正确率、进入「已掌握」的词、段位点提示(段位开时)、新解锁成就(从 `/api/rank/me` 的新成就字段)、「再来一轮」与「回到首页」。

### 11.3 视觉

遵循 redesign-v3:纯白页、顶栏静止透明滚动后玻璃;**青色**是词书身份色(书本图标、进度环、已掌握计数),蓝色只给主按钮与当前空,琥珀给提示与「接近正确」(小笔误、词形不对),绿色给「正确」,错误用中性(`ink-2` 删除线 + 正确拼写为 `ink`)。卡片 14px 圆角、按钮 12px、触控 ≥ 44px;深色按 design-notes 的暗色表。界面装饰不用 emoji。视觉稿:`docs/superpowers/design/wordbook-v1/mockup.html`。

### 11.4 朗读

复用 `~/features/chat` 的 `useTtsPlayer`(在点击手势内解锁 iOS 音频)与 `loadServerAiConfig` 的默认 TTS 模型与声音;单词、例句、整组句子都走同一播放器;共享缓存 `sharedTtsCache`,同一词不重复请求。TTS 未配置时朗读键禁用并显示说明,`dictation` 题型自动换成 `spell`。

### 11.5 拼写输入引擎

- 纯逻辑 `cloze-engine.ts`(reducer):状态 `{values: string[], active: number}`;动作 `type(text)`、`space`、`backspace`、`focus(i)`、`hint(i)`(写入首字母并标记)、`reset`。空格永远不写入空;退格在空的空上回到上一个空并保留其内容;到最后一个空再按空格停在原处。
- 隐藏输入 `use-cloze-input.ts`:一个视觉隐藏但可聚焦的 `<input>`,值 = 哨兵 `​` + 当前空的内容;在 `input` 事件里比较新旧值(安卓 Gboard 的 keyCode 恒为 229,不能依赖 `keydown`):值末尾出现空格 → `space`;哨兵被删 → 空的空上的退格 → `backspace`;其他 → `type`;`compositionstart/end` 期间不处理。`keydown` 的 Enter → 提交。点任意空 → `focus(i)` 并把输入聚焦(在手势内,iOS 才会弹键盘)。
- 键盘遮挡:用已有的 `useAppHeight`(visualViewport)保证当前空滚到可见区;提交按钮跟随键盘上沿。
- 无障碍:每个空 `role="textbox"` 只读呈现,`aria-label="第 2 空,共 5 空"`;当前空 `aria-current`;不对每次按键做 live 播报,只在提交后 `aria-live="polite"` 播报一次总分;尊重 `prefers-reduced-motion`。
- 设置「显示字母数」存在本机(`lib/storage.ts` 的 `WORDBOOK_PREFS_KEY`,登出时清除)。

## 12. 第二阶段

### 12.1 AI 生成短文(模式 A 的连贯版)

- 一次 LLM 调用(提示词 `wordbook.passage`,占位符 `{level}`、`{words}`,边界 `<words>`)返回 JSON:`{"english": "...", "zh": "...", "targets":[{"word":"talk","form":"talking"}], "difficulty":"B1"}`;难度按书级别(初中 A2 / 高中 B1 / 四级 B1+ / 六级 B2 / 考研 B2 / 托福 C1 / SAT C1)。长度 60–120 词。
- 规则校验:JSON 可解析;每个目标词的 `form` 在英文里作为完整词出现恰好一次且原形匹配(§6.6 的变形规则);不出现非目标的挖空标记;`zh` 非空;总长在范围内。不通过 → 重试一次;仍失败或 LLM 不可用(当前 402)→ **回落到第一阶段的例句句组**,界面不报错,只在组标题下显示「本组为词典例句」。
- 缓存:`wordbook_passages`(`cache_key` = sha256(排序后的词 | 级别 | 提示词版本)、`book_id`、`english`、`zh`、`targets` JSON、`status`、`reports`);同一词组同一级别全站复用。「举报这段」→ `wordbook_reports(kind='passage')`;累计 3 次或管理员屏蔽 → `status='bad'` 不再使用。
- 成本:`WORDBOOK_AI_ENABLED` 下;新设置 `wordbook_passages_global_daily`(默认 300)与按用户 `wordbook_passages_daily_per_user`(默认 10);命中缓存不计。迁移 `0013_wordbook_passages`。

### 12.2 用词对话

在对话页开一个预设情景(「今天的 5–8 个词」),系统提示要求 AI 在对话中自然引导用户使用这些词;对话结束点「检查用词」→ 一次 LLM 评判(提示词 `wordbook.chat_judge`,输出每个词 `used/correct/note` 的 JSON)→ 用对的词按 §6.1 记一次 `good`(到期时)或 `practice`。走已有对话 API 与 `config.chat_agent_templates` 机制;评判结果不存原文,只存事件。

### 12.3 单词发音评测

词卡上加「读一读」:复用 `POST /api/speech/assessments`(`reference` = 词头,`save=false`,不入历史、不产生段位点);iFlytek 单词题型需要 `category=read_word`,为 `/api/speech/assessments` 增加可选表单字段 `category`(`sentence` 默认 / `word`)。真机与真实上游未验证前标「未验证」。

### 12.4 同近义 / 同根 / 真题(full 级精简文件)

`server/scripts/wordbook_data.py derive` 从 full 级(下载到临时目录,**不入库**)生成 `extras/<id>.extra.jsonl`:每词 `{"w":键,"syn":[≤8],"rel":[[词性,词,≤20字释义],≤10],"def":"≤160字英英释义","exam":真题数}`;实测七本合计 10.64 MB,最大托福 3.02 MB。**裁定:入 git**(体积小、运行时同一套懒加载与 LRU,另建一份 `ExtrasIndex`)。真题选择题只有 1,217 行,不做题型,只在词卡显示「真题 n 次」。干扰项选择额外排除同近义词。

## 13. 第三阶段及以后

- **摸底测试**:数据**没有词频**,只能用书的级别做近似:从「只在更高级别书出现」的词里按级别分层抽样(每级 8 词),每词「认识/不认识」+ 抽查(选释义)校正;另混入 5 个伪词检测虚报(伪词表内置)。输出「建议从 X 开始」与粗略词汇量区间,**明确告诉用户这是按词书级别估算的,不是按词频**。
- **学习统计**:近 90 天热力图(每天作答数)、累计已学/已掌握曲线、明日与未来 7 天复习预测;数据来自 `wordbook_events` 与 `vocabulary_items`。
- **自定义词表**:管理员上传 CSV/txt(`word,meaning,example`),存数据库 `wordbook_custom_lists` / `wordbook_custom_words`(管理员数据不写进仓库文件);和内置书同样的题型(没有例句的词不出拼写挖空)。
- **以后**:房间里的「词汇对战」、PWA 每日提醒(需要推送基础设施)、离线缓存今日词卡与 TTS、`正序` 的其余 16 本书(GRE、雅思、专八…,每本需同样的数据审查)、模式 B 整段听写。

## 14. 安全、隐私、成本

- 不向第三方主机发送用户数据:朗读走自家 TTS;不加载有道发音链接。
- 日志、审计不记录用户输入的拼写、AI 讲解正文、提示词正文;只记 id、词长、状态码。
- AI 讲解与短文:提示词注入边界标签;输出只作为纯文本显示(网页用已有 `markdown.tsx` 的安全渲染,不允许 HTML)。
- 成本上限:全站每日 + 每人每日 + 缓存;计量可见;402 等上游错误降级不报 500。
- 数据完整性:文件校验和测试;读取时只读打开。

## 15. 测试策略

| 层 | 内容 |
|---|---|
| 数据 | 七个文件字节与 sha256 等于清单;清单与 `books.py` 的 `BOOKS` 一致 |
| 纯函数(pytest) | 清洗与合并(用 `tests/fixtures/wordbook/mini.jsonl` 构造的重复、脏词头、空音标、夹注例句)、索引(偏移、词性位图、丢弃计数)、变形/原形、判分四结果与对齐、干扰项约束、组题、每日计划、洗牌确定性 |
| 数据层 | 选书与暂停、建行与采纳已有词、`max_vocab_items` 只计非词书行、`scope` 过滤、事件与今日计数、到期/未到期写盒规则、乐观并发 |
| 路由 | 开关 404 矩阵、书停用 404、数据缺失 503、`/answers` 与 `/spell/submit` 端到端、每日作答上限、AI 讲解缓存与额度与 402 降级(respx)、日志卫生(caplog) |
| 段位 | 新事件种类入账与每日上限、阶段任务 `words_learned`、新成就快照、旧规则 JSON 兼容 |
| 管理端 | 统计、重新加载与屏蔽的审计、角色矩阵;管理前端页面测试 |
| 网页(vitest) | 输入引擎 reducer 全部按键序列、隐藏输入的哨兵/空格/组合输入、字母差异渲染、会话机(答错回队尾)、各页面中文断言、入口在开关关时不渲染、契约(服务端录制的 JSON 样例) |
| E2E | 开关打开 → 选书 → 学 5 个词 → 复习 → 拼写一组 → 小结(E2E 栈,不调真实 LLM;TTS 在 E2E 栈用真实上游时按已有约定) |
| 视觉 | 视觉稿 vs 真实页面 375×812 浅色与深色截图对照 |

## 16. 风险

| 风险 | 对策 |
|---|---|
| 仓库与镜像变大(+14.6 MB 压缩 / +45.7 MB 镜像,每次数据更新再增) | 固定提交、少更新;`binary` 属性免 diff;必要时改为构建时下载(脚本已具备) |
| 上游内容版权不明 | NOTICE 注明来源;按书可停用;收到主张时整本下线(R-W12) |
| 数据重复与脏数据导致题目错误 | §2.11 清洗、合并与 denylist;例句举报与屏蔽 |
| 「掌握」依赖用户诚实 | 题目判分为主,自评只在「我认识」;掌握需多次间隔成功 |
| 盒子法较粗(无 FSRS) | 产品负责人决定;保留 `wordbook_events` 以便以后评估 |
| 移动端输入法差异(Gboard 229、iOS 自动大写/纠错、中文输入法) | 单一隐藏输入 + 哨兵 + 组合事件;关闭纠错大写;真机清单验证 |
| LLM 余额不足(402) | AI 全部在子开关下,按需、缓存、额度、降级 |
| 刷段位点 | 新点数计入每日上限;作答每日 3,000 次上限 |
| 内存(多 worker) | 懒加载 + 每进程 < 12 MiB |

## 17. 裁定

- **R-W1** 数据文件入 git(产品负责人决定),sentence 级正序七本,每本一个文件,ASCII 文件名;不用 LFS。
- **R-W2** 运行时直接读文件,不导入数据库;按书懒加载索引,读行用 LRU;不做文件监听,管理端手动重新加载。
- **R-W3** 学习状态复用 `vocabulary_items` 与 6 盒算法,不换 FSRS;一个用户一个词一行,词书采纳已有词。
- **R-W4** 词书行不占 `max_vocab_items`;`GET /api/vocabulary` 默认 `scope=mine`。
- **R-W5** 未到期词的作答:错误 → `forgot`,其余不改盒子。
- **R-W6** 已掌握 = `box ≥ 4`。
- **R-W7** 判分完全确定性,无 LLM;四种结果与 credit 100/50/50/0,首字母提示减半。
- **R-W8** 第一阶段按句拼写只用数据集例句(句组),AI 短文在第二阶段且必须能回落。
- **R-W9** 新段位点 `word_learned`/`spelling_set` 计入每日上限;默认阶段练习不变。
- **R-W10** 入口:练习页大卡 + 我的一行;不加底部 Tab。
- **R-W11** 无状态判分(不存题目),客户端回传 `(key, qtype)` / `(key, sentence_id)`。
- **R-W12** 停用或下线一本书不删除用户学习记录。
- **R-W13** 第二阶段精简派生文件入 git。

## 18. 待定问题与默认裁定

1. **新词默认顺序乱序还是书序?** 默认乱序(书序多是字母序,连续 `ab-` 开头既乏味又让干扰项过于相似);可在选书页改。
2. **拼写练习只练到期词,还是也练今日新词?** 默认两者都练(今日新词不改盒子,只有错误才回到盒 0)。
3. **「我认识」直接进盒 2?** 默认是;不额外加一道验证题(减少摩擦),掌握仍需后续复习。
4. **生词本页面是否显示词书单词?** 默认不显示(`scope=mine`),避免几百个词淹没自己收集的词;以后可加筛选。
5. **大小写是否计入判分?** 默认不计(专有名词在讲解里给出正确大小写)。
6. **段位关闭时是否显示成就?** 默认不显示(成就页在段位里)。
7. **AI 讲解是否第一阶段上线?** 默认上线但子开关默认关;当前上游 402,打开前先充值并在诊断里测试连接。
8. **数据更新频率?** 默认不跟随上游;需要时按 §3 的流程单独提交。
9. **是否给词书单独的每日段位点上限?** 默认不单独设,共享 60 点。

**R-credits** 应用内不设「致谢与许可」页(个人使用部署);许可文件随数据保留(`server/dictionaries/` 下的 LICENSE 与仓库根 `NOTICE` 不动)。
