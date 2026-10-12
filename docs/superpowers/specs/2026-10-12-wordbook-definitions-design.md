# 背单词:英英释义 + 学新词页短语自动展开 · 设计

- 日期:2026-10-12 · 状态:用户已确认(见 §1),本文是服务端、网页两份计划的唯一依据
- 前置:`2026-10-10-wordbook-design.md`、`2026-10-11-wordbook-recall-design.md`、`2026-10-11-wordbook-goals-design.md`
- 「核对」处:计划作者必须读真实代码确认,不得凭本文推断

## 1. 用户已确认的决定

| # | 决定 |
|---|---|
| D1 | 单词的释义除中文外**新增英英释义**;不用大模型给上万个词逐个生成,先用网上现成词典 |
| D2 | 英文释义以 **Open English WordNet 2025(CC BY 4.0)** 为主;每个词性取义项顺序靠前的 **2 条**,接受它和中文第一义偶尔对不上 |
| D3 | 虚词和缺口(约 700 个词)用大模型**一次性离线批量**生成,抽查后提交进仓库,运行时不调用;专有名词(国家 / 城市)不加英文释义 |
| D4 | ECDICT(MIT)只在**构建时**用于词形还原和词频,不提供释义 |
| D5 | 界面:中英并列(默认);用户可选「仅中文」「仅英文」;**不做**英英选择题 |
| D6 | 学新词页:翻开释义后短语区**自动展开**;复习页保持折叠;用户手动收起后记住(本机) |
| D7 | 不加「致谢 / 许可」页面:许可文件跟着数据放,根 `NOTICE` 补条目 |

## 2. 数据来源与已核对的事实

| 来源 | 用途 | 协议 | 构建输入文件(本机已下载到 `D:\tmp-ecdict\`,不进仓库) |
|---|---|---|---|
| Open English WordNet 2025 | 英文释义 | CC BY 4.0 | `english-wordnet-2025-index.sense-fixed.zip`(9.6 MB,sha256 `38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93`,内含 WordNet 字典格式 `data.*` / `index.*` / `index.sense` / `*.exc`);`english-wordnet-2025.xml.gz`(11.4 MB,sha256 `9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe`,仅备用) |
| ECDICT 1.0.28 | 词形还原(`exchange`)、词频(`frq`) | MIT | `ecdict-sqlite-28.zip`(216,765,132 字节,sha256 `ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6`,解压得 `stardict.db` 851 MB) |

**覆盖率实测**(1.4625 万个不同单词,7 本书合并):按「中文释义里已有的词性」在 WordNet 里能找到释义 13,924 个(95.2%);只有别的词性 73 个;完全没有 628 个(主要是虚词 `against / although / and / because / during / for / her / him`,和专有名词 `america / canada / england`)。首条释义长度:≤ 8 词 64%,9–14 词 28%,> 14 词 8%。

**已知缺陷(设计已接受)**
- `index.sense` 的语料次数列全是 0,只能按 WordNet 自己的义项顺序(`sense_number`)排序;多数词合理(`abandon` 动词 → 「forsake, leave behind」),少数和中文第一义对不上(`stamp` 名词第一条是「事物的独特形式」而不是「邮票」)。所以每个词性放 2 条,界面标作参考释义。
- 虚词用 WordNet 会选错(`in` → 铟、`it` → 信息技术、`a` → 长度单位):**词性为介词 / 代词 / 冠词 / 连词 / 数词 / 助动词 / 感叹词的词不得走 WordNet**,走 D3 的大模型离线批量(或没有)。

## 3. 数据文件与构建管线(服务端计划)

- 新增目录 `server/dictionaries/wordbook-definitions/`:`definitions.jsonl`(每行 `{"word": "...", "defs": [{"pos": "n|v|a|r|prep|pron|conj|art|num|aux|int", "text": "...", "src": "oewn|llm"}]}`,按单词字母序,UTF-8,LF)、`SOURCE.json`(各输入的名称、版本、URL、sha256、构建日期、脚本版本、条目数、各 `src` 计数)、`LICENSE-OEWN`(CC BY 4.0 声明与归属行)、`LICENSE-ECDICT`(MIT 全文;构建时用到)。`.gitattributes` 把它标 `binary`(与现有单词本一致,校验和稳定);单文件 < 50 MB(预计几 MB)。
- 构建脚本 `server/scripts/wordbook_definitions.py`(不被 `app/` 导入),子命令:`verify`(校验输入哈希)、`build`(从输入目录 + 现有 7 本书生成 `definitions.jsonl`:按中文释义的词性映射到 WordNet 词性 → 取 `sense_number` 靠前的 2 条 → 去掉例句和括号内长注 → 稳定地把 > 14 词的放后面 → 词形还原 `exchange` 命中时用原形 → 写出缺口清单 `missing.txt` 并按类别统计:虚词 / 专有名词 / 缩写 / 复合词 / 其他)、`llm-fill`(见下)、`check`(校验输出与 `SOURCE.json` 一致)。输入目录通过参数或环境变量 `WORDBOOK_DEFS_SOURCES` 给出;**输出必须确定性**(相同输入逐字节相同),有小型夹具的单元测试。
- **`llm-fill`**:读取缺口清单里「虚词 + 其他可定义的词」(排除专有名词 / 缩写),按 40 词一批调用服务端配置的 LLM 上游(仅在开发机手动运行,**运行时代码里不得出现任何 LLM 调用**),提示词要求每个词性一条、≤ 12 个词、用 A2–B1 词汇、只返回 JSON;可断点续跑、写进 `definitions-llm.jsonl`(`src: "llm"`)再合并;抽查 5% 写进报告。**当前上游余额不足(402)**:计划里这一步标为「余额恢复后执行」,没有它功能照常工作(缺口词不显示英文释义)。
- 加载:服务端启动时懒加载 `definitions.jsonl` 到内存字典(几 MB),键为小写单词;`BookIndex` 里的单词与它做键对键查询。

## 4. API(只追加)

- 单词卡对象增加可选 `defs_en`:`[{"pos": "n", "text": "..."}]`(每个词性最多 2 条,缺省 = 没有);出现在学新词 / 复习 / 已学词 / 卡片详情返回的卡片里(核对所有构造卡片的地方,共用一个函数)。
- 用户偏好 `def_lang`:`"both"`(默认)| `"zh"` | `"en"`,存在每用户已有的背单词设置里(核对是 `wordbook_enrollments` 的 JSON、`/config` 的 `defaults`,还是别处;**不新增迁移**,取现有 JSON 字段);`GET /api/wordbook/config` 返回它,`PATCH` 同一个设置接口接受它,逐键校验;未知值 → 422。
- 契约夹具 `wordbook_contract.json` 重录,网页契约测试逐键校验。

## 5. 界面(网页计划)

- **单词卡**(`word-card.tsx`):中文释义之下,每个词性一行小号英文释义(`lang="en"`,`text-ink-2`,最多 2 条)。`def_lang="zh"`:不显示英文;`"en"`:不显示中文释义(词性标签保留;例句译文、短语译文照旧,因为它们不是释义)。
- **遮罩状态**:英文释义与中文释义同属「答案」,遮罩时都不在 DOM 里,翻开后一起出现。
- **不改的地方**:选择题 / 拼写题 / 快速回忆的题面和选项仍用中文(不做英英题型);已学词列表搜索不变。
- **设置**:「我的 → 背单词」或现有每日目标设置面板里加「释义显示:中英 / 仅中文 / 仅英文」(分段控件),保存后立刻对当前页生效。
- **短语自动展开(D6)**:学新词页的单词卡在**没有遮罩(已翻开)**时 `<details open>`;遮罩翻开的那一刻展开一次(遮罩 → 翻开的转换触发,用户之前手动收起过则不展开);用户手动开合会写入本机(`localStorage`,try/catch,取不到当作「自动」);展开时标题行不再重复第一条短语;最多 5 条不变;复习页、已学词页保持折叠(卡片组件用显式属性 `phrasesOpen`:`"auto" | true | false`,学新词页传 `"auto"`,其余默认 `false`)。
- 顺序(手机上):中文释义 → 英文释义 → 例句 → 短语。
- 文案走懒加载文案文件;无新的跨 feature 依赖;主包体积增量 ≤ 0.2 kB gzip(报告数字;基线文件已过期,以计划开始时实测为准)。

## 6. 隐私、许可与规范

- 许可:OEWN 的归属行放在 `LICENSE-OEWN` 与根 `NOTICE`;ECDICT 的 MIT 全文放在 `LICENSE-ECDICT` 与根 `NOTICE`。不做界面致谢页。
- 日志、URL、错误里不出现单词查询以外的用户内容;查询英文释义不会向任何第三方发请求。
- 每个新目录有 `CLAUDE.md`(`server/dictionaries/wordbook-definitions/CLAUDE.md`);`server/dictionaries/CLAUDE.md`、`server/app/wordbook/CLAUDE.md`、`web/src/features/wordbook/CLAUDE.md`、`server/scripts/CLAUDE.md` 同步更新;架构测试不放宽;大数据文件走 Dockerfile 白名单(`Dockerfile.dockerignore`)并由 `tests/test_wordbook_data_files.py` 一类测试校验校验和。
- 构建输入(`D:\tmp-ecdict\…`)不进仓库;计划完成后由主会话清理这些临时文件。

## 7. 不做

英英选择题、让大模型给全部 1.46 万个词逐个挑义项、运行时调用任何词典 / LLM、释义按用户水平改写、专有名词的英文释义、把词典 API 接进网页。

## 8. 计划与合并顺序

| 计划 | 文件 | 内容 |
|---|---|---|
| S 服务端 + 数据 | `plans/2026-10-12-wordbook-definitions-server.md` | 构建脚本与测试、数据文件与许可、加载与查询、卡片 `defs_en`、`def_lang` 设置、契约夹具、`llm-fill`(待余额)、文档与 NOTICE |
| W 网页 | `plans/2026-10-12-wordbook-definitions-web.md` | 单词卡英文释义、遮罩、`def_lang` 设置与类型、短语自动展开(`phrasesOpen`)、文案、契约测试、体积、文档 |

合并顺序:**S → W**(网页契约测试读服务端重录的夹具)。
