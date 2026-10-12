# 背单词 · 英英释义(服务端 + 数据)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给背单词的每张单词卡加上可选的英英释义 `defs_en`:构建脚本 `server/scripts/wordbook_definitions.py`(`verify / build / check / llm-fill`)用 Open English WordNet 2025(CC BY 4.0)为七本词书的单词按「中文释义里已有的词性」各取 2 条英文释义,ECDICT 只在构建时用来做词形还原和词频;虚词与缺口词由一份手写小表(`function-words.jsonl`,约 100 个最常见的虚词)和一次性离线的大模型批量(`llm-fill`,**等上游余额恢复后再跑**,没有它功能照常工作)补齐;生成的 `definitions.jsonl`(约 2.6 MB)连同 `SOURCE.json`、`missing.txt`、两份许可文件和根 `NOTICE` 条目一起提交。运行时 `app/wordbook/definitions.py` 懒加载这份文件(缺失 = 静默没有英文释义),唯一构造卡片的函数 `service.card_out(card, ds)` 追加 `defs_en`;每用户偏好 `def_lang`(`both` 默认 | `zh` | `en`)出现在 `GET /api/wordbook/config`,由现有的 `PATCH /api/wordbook/enrollment` 接收,**不新增迁移**;契约样例 `wordbook_contract.json` 重录一次供网页计划读取。

**Architecture:** 脚本是离线工具(可以导入 `app.wordbook.entry.headword_key`,保证数据的键和 `BookIndex` 的键一致;`app/` 永远不导入脚本,有测试钉住)。构建管线:读 7 本书 → 按书里的词性映射到 WordNet 词性(`n v a r`),虚词词性(`prep pron conj art num aux int`)**不走 WordNet** → 每个(词,词性)按 `index.sense` 的 `sense_number` 顺序取释义、清洗、把 > 14 词的稳定地排到后面、取前 2 条 → 找不到时依次试 WordNet 不规则变形表(`*.exc`)和 ECDICT `exchange` 里的原形 → 与手写表 / 大模型结果合并(有手写条目的词只用手写条目,见 R-DS17;其余按「WordNet > 大模型」逐个(词,词性)合并;WordNet 释义里带明确用法标签的义项先剔除,见 R-DS18) → 按单词字母序、UTF-8、LF 逐字节确定地写出,并写缺口清单与 `SOURCE.json`。运行时一个只用标准库的 `Definitions` 类挂在 `DictionaryStore.definitions` 上,`card_out` 查它;偏好 `def_lang` 没有现成的每用户设置表,按裁定 R-DS3 存成 `wordbook_events` 里 `kind="defpref"` 的一行(取最新一行),无迁移。

**Tech Stack:** Python 3.12(uv)、FastAPI + SQLAlchemy 2 async + pydantic v2、pytest + pytest-asyncio + respx;脚本只用标准库加 `app.*`。不新增依赖,不新增迁移,不改 `enjoy/`、不改 `web/`。

**Spec:** `docs/superpowers/specs/2026-10-12-wordbook-definitions-design.md`(D1–D7 已定,本计划不改它;与代码不符处见「本计划的裁定」)。前置:`docs/superpowers/plans/2026-10-10-wordbook.md`、`2026-10-11-wordbook-goals.md`(`PATCH /enrollment`、`consume_settings`)、`2026-10-12-wordbook-learned-review.md`(`learned/card`、`free/start`)。网页计划 `2026-10-12-wordbook-definitions-web.md` 是兄弟计划,共享契约见文末「跨计划假设」。

## Global Constraints

- **合并顺序(跨计划):本计划(S)→ 网页计划(W)。** W 的契约测试读本计划 P1 重录的 `wordbook_contract.json`;P1 合并之前 W 不得合并。本计划的数据提交(Z2)与代码提交互不依赖,但 Z3 的数据测试必须在 Z2 之后。
- **迁移:不新增。** `alembic heads` 保持写计划时的 `0017`。`def_lang` 的存放见 R-DS3;若执行中证明必须加表或列,先停下来改本计划,不要自行取号。
- **运行时没有 LLM、没有网络。** `app/wordbook/definitions.py` 只导入标准库(`tests/test_wordbook_definitions.py::test_the_loader_module_is_stdlib_only` 钉住);`llm-fill` 只存在于脚本里,只在开发机手动运行。
- **分层不变:** `tests/test_architecture.py` 不放宽、不改。新模块 `app/wordbook/definitions.py` 属于 `wordbook` 包;`app/links/word_actions.py` 已经导入 `wordbook.service`,只多传一个参数。
- **文件归属与共享文件:** 本计划独占 `server/scripts/wordbook_definitions.py`、`server/app/wordbook/definitions.py`、`server/dictionaries/wordbook-definitions/`、`server/tests/test_wordbook_definitions*.py`、`test_wordbook_def_lang.py`。共享文件只在下文列出的插入点做**单点修改**:`service.py`、`store.py`、`index.py`、`routers/wordbook.py`、`links/word_actions.py`、`tests/wordbook_helpers.py`、`tests/test_wordbook_contract.py`(+ 夹具)、根 `NOTICE`、根 `.gitattributes`、几份 `CLAUDE.md`。
- **隐私:** 日志、URL、错误里不出现单词(释义加载只记「跳过了 N 行」这样的数字);`def_lang` 不进 URL(PATCH 体);新增的 `caplog` 一律 `caplog.set_level(..., logger="app")`。查英文释义不向任何第三方发请求。
- **许可:** 许可文件跟着数据放(`LICENSE-OEWN`、`LICENSE-ECDICT`),根 `NOTICE` 补两条;不做界面致谢页(D7)。`LICENSE-ECDICT` 和 `NOTICE` 里的版权行**逐字取自上游 LICENSE 文件**,不手打。
- **工作树是 CRLF**(`core.autocrlf=true`,仓库里是 LF):改现有文件用 Edit 工具,新文件用 Write;数据文件由脚本以字节写出(LF),`.gitattributes` 标 `binary` / `-text`,所以 Windows 上校验和稳定。
- **提交:** conventional(`feat(server): …`、`test(server): …`、`chore(server): …`、`docs: …`),一个任务一个逻辑提交,每个提交后测试全绿,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。**数据提交(Z2)独占一个提交**,信息固定为 `chore(server): add wordbook English definitions (OEWN 2025)`。
- **每个任务结束:** `cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;车道合并前跑全量 `cd server && uv run pytest -q`(约 2.5 分钟,可按文件拆两半)。
- **验证口径(如实):** 写计划时,脚本、运行时、偏好、契约的**全部代码与测试都在一份 `server/` 副本里真实运行过**(新增 136 个测试全绿、改写 1 个契约测试;`tests/test_wordbook_*.py`、`test_rank_wordbook.py`、`test_admin_wordbook.py`、`test_links_word_actions.py` 共 482 个全绿;脚本在真实输入 `D:\tmp-ecdict\` 上完整构建过两次,字节相同,`verify` 与 `check` 通过)。下面计划里的代码就是跑过的代码;文中的真实数字都是那次运行的结果,执行者第一次运行时以真实结果为准(差异先弄清原因,不要改数字迁就)。没有跑过的在文末「未验证清单」。
- 数字取自 spec;改数字先改 spec。

---

## 文件结构

```
server/
  scripts/wordbook_definitions.py              新:verify / build / check / llm-fill(B1–B4)
  scripts/CLAUDE.md                            + 一条(Z1)
  app/wordbook/definitions.py                  新:Definitions(懒加载、线程安全)、select_defs、default_path(R1)
  app/wordbook/index.py                        [共享] DictionaryStore:__init__ 加 definitions、reload 里 reload 它(R2)
  app/wordbook/service.py                      [共享] ensure_hidden +1 行;card_out(card, ds) + defs_en,6 处调用点(R2);
                                               INVALID_DEF_LANG、config_out(+def_lang)、def_lang_of、patch_enrollment(P1)
  app/wordbook/store.py                        [共享] DEF_LANGS / get_def_lang / set_def_lang(P1,接在 consume_settings 之后)
  app/routers/wordbook.py                      [共享] GET /config 加 session;GoalsPatchIn + def_lang(P1)
  app/links/word_actions.py                    [共享] card_out(found, ds)(R2)
  app/wordbook/CLAUDE.md、routers/CLAUDE.md    (Z1)
  dictionaries/wordbook-definitions/           新:definitions.jsonl(Z2 生成)、missing.txt(Z2)、SOURCE.json(Z2)、
                                               function-words.jsonl(D1 手写)、LICENSE-OEWN、LICENSE-ECDICT、CLAUDE.md(D1)
                                               (llm-fill 之后才有 definitions-llm.jsonl:L1)
  dictionaries/CLAUDE.md、server/CLAUDE.md、tests/CLAUDE.md   (Z1)
  tests/test_wordbook_definitions_build.py     新:脚本的单元测试,全部用夹具(B1–B4、D1)
  tests/test_wordbook_definitions.py           新:加载器与每个构造卡片的端点(R1、R2)
  tests/test_wordbook_def_lang.py              新:def_lang(P1)
  tests/test_wordbook_definitions_data.py      新:提交的数据文件(Z3)
  tests/wordbook_helpers.py                    [共享] + MINI_DEFS、make_defs_dir(R1)
  tests/test_wordbook_contract.py              [共享] 配迷你释义、加 def_lang_patch、修一处陈旧断言(P1)
  tests/fixtures/wordbook_contract.json        [共享] 重录一次(P1)
NOTICE                                         [共享] + OEWN、ECDICT 两条(D1)
.gitattributes                                 [共享] + .txt binary、SOURCE.json -text(D1)
```

`server/Dockerfile`(`COPY server/dictionaries /app/dictionaries`)和 `server/Dockerfile.dockerignore`(`!server/dictionaries`)**不需要改**:新目录在已有的白名单之内;Z3 的数据测试断言这两行仍在。`.gitattributes` 里已有的 `server/dictionaries/**/*.jsonl binary` 已覆盖三个 `.jsonl`,只需补 `.txt` 与 `SOURCE.json`。

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件 | 依赖 |
|---|---|---|---|
| **B 构建脚本**(一个执行者,串行) | B1 → B2 → B3 → B4 | `scripts/wordbook_definitions.py`、`tests/test_wordbook_definitions_build.py` | 无(只读 `app.wordbook.entry`) |
| **R/P 运行时与偏好**(一个执行者,串行) | R1 → R2 → P1 | `app/wordbook/definitions.py`、`test_wordbook_definitions.py`、`test_wordbook_def_lang.py` + 共享文件的单点修改 | 无;P1 的契约夹具给网页计划 |
| **D 数据与许可** | D1 | `dictionaries/wordbook-definitions/` 中手写与许可文件、`NOTICE`、`.gitattributes` | D1 的手写表在 Z2 才被构建校验;D1 自带的测试只依赖 B2 |
| **Z 收尾**(合并后) | Z1 → Z2 → Z3 | 文档、生成数据、数据测试 | B、R/P、D 全部合并 |
| **L 大模型补缺口** | L1(**BLOCKED**) | `definitions-llm.jsonl`、重新生成的数据 | Z3 之后、上游余额恢复 |

**合并顺序:** B1 → B2 → B3 → B4 → R1 → R2 → P1 → D1 → Z1 → Z2 → Z3;L1 在余额恢复后随时做。B 车道和 R/P 车道没有共同文件,可以并行开发,按上面的顺序合并;D1 里的测试用到 B2 的 `read_extras`,所以 D1 在 B2 之后。

---

## 本计划的裁定

> 格式:**裁定 / 为什么 / 猜错的代价**。spec 不改;和代码对不上的地方在这里决定。

- **R-DS1 构建脚本导入 `app.wordbook.entry.headword_key`。** 为什么:数据的键必须和 `BookIndex` 的键逐字一致(NFC、折叠撇号、小写、去掉 `adj.` 这类词性缩写和 DENYLIST);复制一份规则迟早分叉。spec 说脚本「不被 `app/` 导入」,没说脚本不能导入 `app/`,`scripts/CLAUDE.md` 也允许。代价:`definitions.jsonl` 的内容依赖 `app/wordbook/books.py` 的 DENYLIST;改了 DENYLIST 要重建。Z3 的数据测试(`keys <= BookIndex 键集`)会在不一致时变红。
- **R-DS2 缺口清单只列「零释义的词」和「虚词词性缺口」;开放词性的局部缺口不列、不补。** 实测:写 `n` 和 `v` 的词,WordNet 只有名词义,动词没有——这类 1,320 个词保留已有的那一行,缺的那个词性没有英文行(`stats.partial_open_pos` 计数)。为什么:spec 的「约 700 个词」指零释义的词(实测 636)加虚词缺口;把局部缺口全送大模型要多约 1,300 个词的钱,而且这些词的英文行本来就是「参考」。代价:个别词的某个词性没有英文行;日后要补,把 `llm_candidates` 的过滤放宽即可,数据格式不变。
- **R-DS3 `def_lang` 存成 `wordbook_events` 里 `kind="defpref"` 的一行,不新增迁移。** spec §4 说存在「每用户已有的背单词设置里」,但**代码里没有这样的地方**:`wordbook_enrollments` 是每本书一行、没有 JSON 列;每日目标在那张表的整数列里;`agent_user_settings` 是智能体层的表,`app/agents/settings.py` 的 `save` 会整行写回、丢掉不认识的键,`wordbook` 层也不能导入 `agents`;`user_link_prefs` 只有布尔值。所以取「事件流水当偏好」:`book_id=""`、`outcome` 存值(≤ 12 字符)、取最新一行;`rank` 只读 `learn/spell_set`,计划只数 `learn/relearn/review`,管理端按书的统计带 `book_id` 过滤,都读不到它(P1 有测试);条数受「设置每日 60 次」限制,值没变不写。为什么:用户任务和 spec 都要求无迁移,这是唯一不碰迁移也不跨层的做法。代价:偏好历史行永久保留(每用户最多每天 60 行,实际极少);`GET /config` 多一次走 `ix_wordbook_events_book_id_kind` 的查询;以后若要换成真正的列,是一次数据拷贝(取每用户最新一行)。
- **R-DS4 写入口是现有的 `PATCH /api/wordbook/enrollment`,新增可选体字段 `def_lang`;它单独出现时不需要有在学的书。** 响应:体里**没有** `def_lang` 时和以前逐字相同;有时在原响应(有在学的书则是 enrollment 对象,否则是 `{}`)上再加 `"def_lang": <值>`。值没变 = 不写、不扣「设置每日 60 次」;和目标字段一起传只扣一次;未知值 → 422(pydantic `Literal`);`def_lang: null` 单独传 = 「No changes」422。为什么:spec 要求「同一个设置接口」;「我的」页可能在没有选书时就改偏好,所以不能强制在学。代价:这个端点现在既管书的目标又管用户偏好,命名有点宽;网页的 `patchEnrollment` 返回类型要把 `def_lang` 当可选键。
- **R-DS5 释义文件与词书目录同级:`<数据目录的上级>/wordbook-definitions/definitions.jsonl`,不新增设置项。** 默认就是 `server/dictionaries/wordbook-definitions/`(容器里 `/app/dictionaries/...`);测试里 `make_data_dir` 是 `<tmp>/dict`,释义放 `<tmp>/wordbook-definitions/`。为什么:新增设置要进设置注册表、`.env.example`、管理端,代价大于收益。代价:运营者把 `WORDBOOK_DATA_DIR` 指到别处时,要把 `wordbook-definitions/` 放在它旁边,否则静默没有英文释义(`CLAUDE.md` 写明;管理端诊断不检查,见「不做」)。
- **R-DS6 重录契约夹具前,先修 HEAD 上一处已经坏掉的断言。** 实测:`CONTRACT_UPDATE=1 pytest tests/test_wordbook_contract.py` 在当前 HEAD 就失败——`assert ... expected["answer_free"]["applied"] is True` 读的是**刚录好的**值,而 `able` 是同一个测试里刚学的词,R-L6(24 小时内刚学的词不能被自由答错拉到今天到期)让 `applied` 变成 `False`;只读模式能过,是因为它读的是提交的夹具(里面存着 `True`),不是这次运行的值。修法:录制前把 `able` 的 `created_at` 往前改两天(P1)。另外:夹具里的值(用户 id 随机 → 选项顺序、时间戳)每次重录都会变,**只有形状稳定**;网页契约测试必须只核对键/形状以及 `defs_en`、`def_lang` 的值,不能依赖其他值。
- **R-DS7 手写虚词表:写约 100 个最常见的虚词词性(103 个词、116 条),`src: "hand"`,优先级最高。** 为什么:大模型暂时不可用,而 `the / of / and / in / to / it` 这些词是学新词时最先遇到的,没有英文行会让功能看起来坏了;手写 100 条的成本是一次性的,且可以逐条审。来源是 ECDICT 词频排序的虚词缺口(`missing.txt` 的前几行),**词性必须是书里给这个词的词性**(构建在手写表里出现书里没有的词性时直接报错,防笔误)。优先级:有手写条目的词整词只用手写条目(R-DS17,取代这里原来的「按(词,词性)逐个生效」);其余词 WordNet > 大模型。代价:手写的 116 条没有第二个人逐条审(Z2 的抽查会带上它们);大模型补上来之后,同一(词,词性)仍以手写为准。
- **R-DS17 有手写条目的词,手写条目整词胜出:不再给这个词加任何 OEWN 行。** 为什么:实测 `in` 因一本书也把它标成 `n` 而得到 indium / inch,`a` 得到 vitamin A / angstrom,对学习者是噪音。取代 R-DS7 / Z-2 原来的「按(词,词性)逐个」。代价:手写词若书里还有开放词性(如 `n`),那个词性没有英文行(计入 `partial_open_pos`,可日后手写补);大模型行仍可补手写没写的词性。构建器 `SCRIPT_VERSION` 升到 2。
- **R-DS18 剔除带明确用法标签的 OEWN 义项,仅当该词性还有别的义项。** 为什么:OEWN 的标签只有两处真实可见:(1) 释义开头的括号标签,如 `(slang)`、`(British informal)`、`(archaic)`、`(ethnic slur)`;(2) 释义开头的 `slang for …` / `informal term for …` / `vulgar expression for …`。不算标签的:带「usually / sometimes」的括号、`(military)` 这类主题括号、单独的地区词、`(euphemism)`、正文里的 obsolete / rare(如「an obsolete firearm」描述的是物件本身)。数据里的用法域指针(`;u`:slang、colloquialism、disparagement、obscenity 等)实测太杂(`insect`、`gorilla` 标成 disparagement,`bite` 标成 slang),不用;`lex_filenum` 只是语义类别(noun.person 等),不含用法。所以 `grass` 的 "a police informer" 和 `confident` 的 "persuaded of" 在数据里没有任何标记,本规则不会动它们(接受)。代价:启发式,只剔除能确定的;若所有义项都带标签则保持原顺序,绝不删唯一义项。`SOURCE.json` 多一个统计 `usage_filtered_pairs`。
- **R-DS8 「只有别的词性」的词不用 WordNet 的别的词性顶替。** spec §2 测得 73 个(加上词形还原后,构建实测 45 个),如 `audio`(书里只有 `adj`,WordNet 只有 `noun`)。为什么:界面按词性分行,把名词释义放在形容词行下面会误导。它们归类 `pos_mismatch`,可由大模型补(L1)。代价:这 45 个词暂时没有英文行。
- **R-DS9 缺口分类:spec 的五类加一类 `pos_mismatch`,优先级固定。** `function`(缺口里有任何虚词词性,不管这个词别的词性有没有释义)→ `abbr`(书里标过 `abbr`、写法含 `.` 或全大写)→ `proper`(书里的写法首字母大写,且小写形式在 WordNet 里没有)→ `compound`(含空格或连字符)→ `pos_mismatch` → `other`。专有名词与缩写不送大模型(D3)。代价:启发式,少数边界词(如 `Jesus`、`Monroe`)分类可能不准,只影响是否送大模型,抽查会看到。
- **R-DS10 文件里保留每个词性最多 2 条;运行时再按「每词性 ≤ 2、总共 ≤ 4」选。** 选法(`select_defs`):名额先给每个词性的第一条(按文件里的词性顺序),再给第二条,结果保持文件顺序。为什么:5 个词性的词不能只剩前两个词性;spec §4 的「≤ 4」在 API 层执行,数据文件不丢信息。代价:无。
- **R-DS11 ECDICT 只用 `exchange` 里的 `0:` 原形和 `frq` 词频。** 原形只在「原词和 WordNet 不规则变形表都找不到」时才用;`frq`(越小越常见,0 = 未知)只用来给 `missing.txt` 排序(常用词先送大模型、先被抽查)。代价:无。
- **R-DS12 输入定位:在 `--sources`(或环境变量 `WORDBOOK_DEFS_SOURCES`)下按文件名递归找两个 zip;WordNet 文件直接从 zip 里读,不解压;`stardict.db`(851 MB)已解压在 sources 下且大小对就复用,否则解压到 `--work`(默认系统临时目录)。** `verify` 校验两个 zip 的字节数和 sha256(钉在脚本的 `INPUTS`)。代价:第一次构建在没有解压的机器上要多解压 851 MB。
- **R-DS13 `SOURCE.json` 的构建日期不破坏确定性。** `build --built YYYY-MM-DD` 显式给;不给时,若新生成的 `definitions.jsonl` 和旧 `SOURCE.json` 里记录的哈希相同就沿用旧日期,否则取今天(UTC)。同样输入连跑两次,所有输出文件逐字节相同(测试钉住)。
- **R-DS14 运行时:懒加载 + 在事件循环外预热,首次同步兜底。** `ensure_hidden`(几乎所有出卡片的路径都先调它)里 `await ds.definitions.warm()`(`asyncio.to_thread`,幂等);没经过它的路径(若有)第一次 `defs_for` 在锁里同步加载。实测(计划作者机器、真实生成的文件):14,019 个词、约 191 ms、约 5.7 MiB(`tracemalloc`)。代价:每个进程第一次出卡片多约 0.2 s,一次。
- **R-DS15 `llm-fill`:只处理 `missing.txt` 里除专有名词和缩写之外、有明确词性的行;40 词一批;严格校验,整词通过才收。** 回复必须是 JSON 数组(容许一个 ``` 围栏块);每个被问的词必须恰好每个被问的词性一条、`text` 非空、≤ 12 个词、无中日韩字符、无换行;有任何一条不合格,**这个词整个丢弃**,留在队列里下次再试。写出的 `definitions-llm.jsonl` 每批之后整体按词排序重写(断点续跑:已在文件里的词不再问)。上游任何失败(余额 402、网络、配置)都立刻停下、保留进度、退出码 3。抽查 5%(固定种子 `20261012`)写到报告文件,人工看完再 `build` 合并。实际调用走 `app.providers.llm.complete` 和 `server/.env` 里的 `UPSTREAM_LLM_*`,模型 `default_llm_model`。代价:整词丢弃会让个别难词一直留在队列里;可手工写进 `function-words.jsonl`。
- **R-DS16 不动管理端与诊断。** 定义文件缺失不报管理端诊断(`app/admin/doctor.py` 只查词书文件)。为什么:spec 要求「缺失 = 静默降级」,诊断项属于管理端计划。代价:运营者要看 `docker exec ... ls` 才知道释义没部署;见「不做」。

---

## Lane B · 构建脚本

> 脚本分四次追加成一个文件;测试文件同样分次追加。每次追加都接在文件末尾,前面空两行。

### Task B1: 词性映射、释义清洗、取前 2 条

**Files:**
- Create: `server/scripts/wordbook_definitions.py`(第一部分)
- Create: `server/tests/test_wordbook_definitions_build.py`(第一部分)

**Interfaces:**
- Produces(`scripts/wordbook_definitions.py`):`OPEN_POS`、`CLOSED_POS`、`ALL_POS`、`SRC_VALUES`、`CATEGORIES`、`MAX_PER_POS = 2`、`LONG_GLOSS_WORDS = 14`、`LLM_MAX_WORDS = 12`、`LLM_BATCH = 40`、`INPUTS`(两个输入的名称/版本/许可/字节数/sha256)、`pos_tokens(type_str) -> list[str]`、`map_pos(type_str) -> list[str]`(`n v a r prep pron conj art num aux int`,未知词元如 `abbr` 消失)、`clean_gloss(gloss) -> str`、`pick_texts(glosses, limit=2) -> list[str]`、`sha256_of`、`write_bytes`、`dump_line`。
- Consumes:`app.wordbook.entry.headword_key`。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_wordbook_definitions_build.py`:

````python
"""The offline builder scripts/wordbook_definitions.py (spec 2026-10-12-wordbook-definitions §3): fixtures only, no real sources."""
import asyncio
import importlib.util
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

import httpx
import pytest
import respx

from app.core.metering import METER

SERVER = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _load()

HEADER = "  1 This software and database is being provided to you, the LICENSEE, by Princeton University\n"
LONG = "a long definition that keeps going on and on with far more than fourteen words so it must move back"

INDEX_SENSE = """abandon%2:40:01:: 02000002 2 0
abandon%2:40:00:: 02000001 1 0
abandon%1:07:00:: 05000001 1 0
stamp%1:06:02:: 05000004 3 0
stamp%1:06:00:: 05000002 1 0
stamp%1:06:01:: 05000003 2 0
child%1:18:00:: 05000005 1 0
big%3:00:00:: 01000001 1 0
quick%5:00:00:fast:01 01000002 1 0
quickly%4:02:00:: 00100001 1 0
in%1:27:00:: 05000006 1 0
in%4:02:00:: 00100002 1 0
ice_cream%1:13:00:: 05000007 1 0
go%2:38:00:: 02000003 1 0
dog%1:05:00:: 05000008 1 0
fast%3:00:00:: 01000003 1 0
sketch%1:06:00:: 05000009 1 0
"""
DATA = {
    "data.noun": [
        "05000001 04 n 01 abandon 0 000 | the trait of lacking restraint (see the long note on this word in the entry); \"wild abandon\"",
        "05000002 04 n 01 stamp 0 000 | a small adhesive piece of paper",
        "05000003 04 n 01 stamp 0 000 | an official mark",
        f"05000004 04 n 01 stamp 0 000 | {LONG}",
        "05000005 04 n 01 child 0 000 | a young person; \"the child cried\"; \"she has a child\"",
        "05000006 04 n 01 in 0 000 | a metallic element",
        "05000007 04 n 01 ice_cream 0 000 | a frozen dessert made from cream; \"he ate ice cream\"",
        "05000008 04 n 01 dog 0 000 | a domesticated canine",
        "05000009 04 n 01 sketch 0 000 | a quick drawing",
    ],
    "data.verb": [
        "02000001 40 v 01 abandon 0 000 | forsake, leave behind; \"abandon your children\"; \"abandon your car\"",
        "02000002 40 v 01 abandon 0 000 | give up with the intent of never claiming again",
        "02000003 38 v 01 go 0 000 | move away from a place",
    ],
    "data.adj": [
        "01000001 00 a 01 big 0 000 | above average in size (more than usual) or number; \"a big building\"",
        "01000002 00 s 01 quick 0 000 | speedy",
        "01000003 00 a 01 fast 0 000 | acting or moving quickly",
    ],
    "data.adv": ["00100001 02 r 01 quickly 0 000 | with rapid movements", "00100002 02 r 01 in 0 000 | inside a place"],
}
EXC = {"noun.exc": "children child\n", "verb.exc": "went go\nabandoned abandon\n", "adj.exc": "", "adv.exc": ""}


# ---- part of speech ----

@pytest.mark.parametrize("raw, expected", [
    ("n", ["n"]), ("n.", ["n"]), ("vt", ["v"]), ("vi", ["v"]), ("v", ["v"]), ("adj", ["a"]), ("a", ["a"]),
    ("ad", ["r"]), ("adv", ["r"]), ("a&ad", ["a", "r"]), ("n&adj", ["n", "a"]), ("ad&prep", ["r", "prep"]),
    ("vt & vi", ["v"]), ("prep", ["prep"]), ("pron", ["pron"]), ("conj", ["conj"]), ("conjunction", ["conj"]),
    ("art", ["art"]), ("indefinite article", ["art"]), ("determiner", ["art"]), ("num", ["num"]), ("aux", ["aux"]),
    ("modal verb", ["aux"]), ("int", ["int"]), ("interjection", ["int"]), ("abbr", []), ("neg", []), ("", []),
    (None, []), ("[��]n", [])])
def test_map_pos(raw, expected):
    assert wd.map_pos(raw) == expected


def test_closed_class_pos_never_read_wordnet():
    assert set(wd.CLOSED_POS) == {"prep", "pron", "conj", "art", "num", "aux", "int"} and set(wd.OPEN_POS) == {"n", "v", "a", "r"}
    assert not set(wd.CLOSED_POS) & set(wd.OPEN_POS)


# ---- gloss cleaning ----

@pytest.mark.parametrize("gloss, expected", [
    ('forsake, leave behind; "abandon your children"; "abandon your car"', "forsake, leave behind"),
    ('a young person; "the child cried"', "a young person"),
    ("above average in size (more than usual) or number", "above average in size (more than usual) or number"),
    ("the trait of lacking restraint (see the long note on this word in the entry)", "the trait of lacking restraint"),
    ('say "hello" to someone', "say to someone"),
    ("move (as in dance; slowly) forward; example", "move (as in dance; slowly) forward"),
    ("  spaced   out  ;", "spaced out"), ('"just a quote"', ""), ("", ""),
    ("broken (paren text", "broken paren text"),
    ("a thing (a very long remark with many words inside (and more)) here", "a thing here"),
])
def test_clean_gloss(gloss, expected):
    assert wd.clean_gloss(gloss) == expected


def test_pick_texts_moves_long_glosses_back_stably_and_keeps_two():
    long_a, long_b = " ".join(["w"] * 15), " ".join(["x"] * 16)
    got = wd.pick_texts([long_a, "short one", long_b, "short two", "short three"])
    assert got == ["short one", "short two"]
    assert wd.pick_texts([long_a, long_b, "short one"]) == ["short one", long_a]
    assert wd.pick_texts([long_a, long_b]) == [long_a, long_b]  # all long: sense order kept
    assert wd.pick_texts(["Same", "same", "other"]) == ["Same", "other"]  # duplicates dropped
    assert wd.pick_texts(['"only an example"', "ok"]) == ["ok"] and wd.pick_texts([]) == []
````

- [ ] **Step 2: 运行确认失败**

`cd server && uv run pytest -q tests/test_wordbook_definitions_build.py` → 失败(`FileNotFoundError`:脚本还不存在)。

- [ ] **Step 3: 实现** — 创建 `server/scripts/wordbook_definitions.py`:

````python
#!/usr/bin/env python3
"""Build / verify / check / fill the wordbook English definitions (spec 2026-10-12-wordbook-definitions §3).

Offline operator tool; `app/` never imports it and nothing here runs at request time. From server/:
  uv run python scripts/wordbook_definitions.py verify  --sources D:\\tmp-ecdict
  uv run python scripts/wordbook_definitions.py build   --sources D:\\tmp-ecdict
  uv run python scripts/wordbook_definitions.py check
  uv run python scripts/wordbook_definitions.py llm-fill            # needs the LLM upstream (dev machine only)
`--sources` defaults to the env var WORDBOOK_DEFS_SOURCES. Output is deterministic: the same inputs give
byte-identical files. Never prints keys, prompts or replies; only counts and words from the public word lists.
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import hashlib
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Protocol

SERVER = Path(__file__).resolve().parents[1]
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from app.wordbook.entry import headword_key  # noqa: E402  (same normalisation as BookIndex keys)

DATA_DIR = SERVER / "dictionaries" / "wordbook-definitions"
BOOKS_DIR = SERVER / "dictionaries" / "kylebing-english-vocabulary"
BOOK_IDS = ("junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat")
SCRIPT_VERSION = 1
MAX_PER_POS = 2
LONG_GLOSS_WORDS = 14       # glosses longer than this go behind the shorter ones (stable)
MAX_PAREN_WORDS = 4         # parentheses with more words are dropped from a gloss
LLM_MAX_WORDS = 12          # also the limit for hand-written entries
LLM_BATCH = 40
SPOT_CHECK_PCT = 5
OPEN_POS = ("n", "v", "a", "r")
CLOSED_POS = ("prep", "pron", "conj", "art", "num", "aux", "int")
ALL_POS = OPEN_POS + CLOSED_POS
SRC_VALUES = ("oewn", "hand", "llm")
CATEGORIES = ("function", "proper", "abbr", "compound", "pos_mismatch", "other")
FILES = {"definitions": "definitions.jsonl", "hand": "function-words.jsonl", "llm": "definitions-llm.jsonl",
         "missing": "missing.txt", "manifest": "SOURCE.json"}

INPUTS = {
    "oewn": {"name": "Open English WordNet", "version": "2025", "license": "CC BY 4.0",
             "homepage": "https://en-word.net/", "file": "english-wordnet-2025-index.sense-fixed.zip",
             "bytes": 9_616_299, "sha256": "38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93"},
    "ecdict": {"name": "ECDICT", "version": "1.0.28", "license": "MIT",
               "homepage": "https://github.com/skywind3000/ECDICT", "file": "ecdict-sqlite-28.zip",
               "bytes": 216_765_132, "sha256": "ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6"},
}
ECDICT_DB = "stardict.db"
ECDICT_DB_BYTES = 851_288_064



# ---------------------------------------------------------------- hashing / io

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)  # bytes, never text mode: LF on Windows too


def dump_line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))



# ---------------------------------------------------------------- part of speech

_POS_TOKEN = {
    "n": "n", "noun": "n", "v": "v", "vt": "v", "vi": "v", "verb": "v", "a": "a", "adj": "a", "adjective": "a",
    "ad": "r", "adv": "r", "adverb": "r", "prep": "prep", "pron": "pron", "conj": "conj", "conjunction": "conj",
    "art": "art", "determiner": "art", "indefinite article": "art", "definite article": "art", "num": "num",
    "aux": "aux", "modal verb": "aux", "modalverb": "aux", "modal": "aux", "int": "int", "interj": "int",
    "interjection": "int",
}
_POS_SPLIT = re.compile(r"[&/,]")


def pos_tokens(type_str: str | None) -> list[str]:
    """Raw lower-case tokens of a book `type` such as 'a&ad' -> ['a', 'ad'] (punctuation dots dropped)."""
    out = []
    for part in _POS_SPLIT.split((type_str or "").lower()):
        token = part.strip().strip(".").strip()
        if token:
            out.append(token)
    return out


def map_pos(type_str: str | None) -> list[str]:
    """Canonical POS list for a book `type` (order kept, no duplicates); unknown tokens (abbr, neg, garbage) vanish."""
    out: list[str] = []
    for token in pos_tokens(type_str):
        pos = _POS_TOKEN.get(token)
        if pos and pos not in out:
            out.append(pos)
    return out



# ---------------------------------------------------------------- gloss cleaning

_QUOTED = re.compile(r'"[^"]*"')


def _first_clause(text: str) -> str:
    depth = 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            return text[:i]
    return text


def _drop_long_parens(text: str) -> str:
    """Remove every outermost (...) group with more than MAX_PAREN_WORDS words (nested groups count as part of it)."""
    out: list[str] = []
    depth = start = last = 0
    for i, ch in enumerate(text):
        if ch == "(":
            if depth == 0:
                start = i
            depth += 1
        elif ch == ")" and depth > 0:
            depth -= 1
            if depth == 0 and len(text[start + 1:i].split()) > MAX_PAREN_WORDS:
                out.append(text[last:start])
                last = i + 1
    out.append(text[last:])
    return "".join(out)


def clean_gloss(gloss: str) -> str:
    """WordNet gloss -> one short definition: first clause (examples come after ';'), no quoted text, long
    parentheses dropped, spaces and trailing punctuation tidied. May return ''."""
    text = _drop_long_parens(_QUOTED.sub("", _first_clause(gloss or "")))
    if text.count("(") != text.count(")"):
        text = text.replace("(", "").replace(")", "")
    return " ".join(text.split()).strip(" ;,:-")


def pick_texts(glosses: list[str], limit: int = MAX_PER_POS) -> list[str]:
    """Clean in sense order, drop empties and duplicates, move > LONG_GLOSS_WORDS-word glosses behind the shorter
    ones (stable), keep `limit`."""
    seen: set[str] = set()
    short: list[str] = []
    long: list[str] = []
    for gloss in glosses:
        text = clean_gloss(gloss)
        if not text or text.casefold() in seen:
            continue
        seen.add(text.casefold())
        (long if len(text.split()) > LONG_GLOSS_WORDS else short).append(text)
    return (short + long)[:limit]
````

- [ ] **Step 4: 运行通过**

`cd server && uv run pytest -q tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```
git add server/scripts/wordbook_definitions.py server/tests/test_wordbook_definitions_build.py
git commit -m "feat(server): wordbook definitions builder, part of speech and gloss rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task B2: 读 WordNet / ECDICT / 词书、合并、缺口清单、清单文件与校验

**Files:**
- Modify: `server/scripts/wordbook_definitions.py`(追加第二部分)
- Modify: `server/tests/test_wordbook_definitions_build.py`(追加夹具与测试)

**Interfaces:**
- Produces:`read_wordnet(zip_path) -> WordNet`(`gloss_list(lemma, pos)` 按 `sense_number` 排序,空格当下划线查;卫星形容词 `ss_type 5` 归 `a`;许可头(两个空格开头的行)被跳过)、`parse_exchange`、`read_ecdict(db, words) -> dict[str, EcdictInfo]`、`collect_wanted(books_dir, book_ids) -> (dict[str, WordInfo], dropped)`、`read_extras(path, src, *, strict)`、`validate_def`、`find_defs`、`categorize`、`build_entries(...) -> BuildResult`、`render_definitions`、`render_missing`、`read_missing`、`find_file`、`verify(root) -> list[str]`、`ecdict_db(root, work)`、`build(sources, data_dir, books_dir, *, built, work, wordnet_zip, ecdict_path) -> BuildResult`、`check(data_dir) -> list[str]`、`definitions_problems(path)`。
- 文件格式:`definitions.jsonl` 每行 `{"word","defs":[{"pos","text","src"}]}`(紧凑 JSON、UTF-8、LF、按词排序);`missing.txt` 每行 `词<TAB>词性(逗号)<TAB>类别<TAB>frq`;`SOURCE.json` 见 `build_manifest`。

- [ ] **Step 1: 追加失败测试** — 在测试文件末尾追加(夹具:一个迷你 WordNet zip、一个迷你 ECDICT sqlite、两本迷你词书;测试里的期望是手算的):

````python
def make_wordnet_zip(path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("oewn2025/", "")
        zf.writestr("oewn2025/index.sense", INDEX_SENSE)
        for name, lines in DATA.items():
            zf.writestr(f"oewn2025/{name}", HEADER + "\n".join(lines) + "\n")
        for name, text in EXC.items():
            zf.writestr(f"oewn2025/{name}", text)
    return path


def make_ecdict(path: Path) -> Path:
    con = sqlite3.connect(path)
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)", [
        ("dogs", "0:dog/1:s3", 0), ("dog", "s:dogs", 900), ("the", "s:thes", 1), ("Child", "p:x", 500),
        ("child", "s:children", 400), ("in", "s:ins", 6), ("abandoned", "0:abandon/1:p", 0)])
    con.commit()
    con.close()
    return path


def book_row(word: str, *types: str) -> dict:
    return {"word": word, "us": "", "uk": "", "translations": [{"translation": "x", "type": t} for t in types],
            "phrases": [], "sentences": []}


ROWS = {
    "junior": [book_row("abandon", "vt", "n"), book_row("stamp", "n"), book_row("Child", "n"), book_row("big", "adj"),
               book_row("quick", "a"), book_row("quickly", "ad"), book_row("in", "prep", "n"), book_row("the", "art"),
               book_row("dogs", "n"), book_row("went", "v"), book_row("ice cream", "n"), book_row("a.", "n")],
    "senior": [book_row("America", "n"), book_row("TV", "n"), book_row("sweaty", "a"), book_row("fast", "a&ad"),
               book_row("sketch", "v"), book_row("mr.", "n"), book_row("hard-working", "a"), book_row("children", "n"),
               book_row("abandon", "vi"), book_row("untyped")],
}


def make_books(folder: Path) -> Path:
    folder.mkdir(exist_ok=True)
    for book in wd.BOOK_IDS:
        rows = ROWS.get(book, [])
        (folder / f"{book}.jsonl").write_bytes(
            ("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)).encode("utf-8"))
    (folder / "SOURCE.json").write_bytes(b'{"commit": "test"}\n')
    return folder


@pytest.fixture
def env(tmp_path):
    return {"zip": make_wordnet_zip(tmp_path / "wn.zip"), "db": make_ecdict(tmp_path / "stardict.db"),
            "books": make_books(tmp_path / "books"), "out": tmp_path / "out"}


def run_build(env, **kw):
    return wd.build(None, env["out"], env["books"], built="2026-10-12", wordnet_zip=env["zip"], ecdict_path=env["db"], **kw)


def rows_of(env) -> dict[str, list[tuple[str, str, str]]]:
    out = {}
    for line in (env["out"] / "definitions.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        out[row["word"]] = [(d["pos"], d["text"], d["src"]) for d in row["defs"]]
    return out


# ---- WordNet / ECDICT readers ----

def test_read_wordnet_orders_by_sense_number_maps_satellites_and_skips_the_licence_header(env):
    wn = wd.read_wordnet(env["zip"])
    assert wn.gloss_list("abandon", "v")[0].startswith("forsake")  # sense 1 first although listed second
    assert wn.gloss_list("quick", "a") == ["speedy"]  # ss_type 5 (satellite) is an adjective
    assert [wn.glosses[("n", off)][:10] for _, off in sorted(wn.senses[("stamp", "n")])] == [
        "a small ad", "an officia", "a long def"]
    assert wn.gloss_list("ice cream", "n")[0].startswith("a frozen")  # spaces look up as underscores
    assert wn.exceptions[("n", "children")] == ["child"] and wn.exceptions[("v", "went")] == ["go"]
    assert not any(key[1] == "x" for key in wn.glosses) and all(not g.startswith("1 This") for g in wn.glosses.values())


@pytest.mark.parametrize("exchange, lemma", [("0:go/1:p", "go"), ("p:went/d:gone", None), ("", None), (None, None),
                                             ("1:p/0:Dog", "dog")])
def test_parse_exchange(exchange, lemma):
    assert wd.parse_exchange(exchange) == lemma


def test_read_ecdict_keeps_only_wanted_words_and_prefers_the_exact_lowercase_row(env):
    info = wd.read_ecdict(env["db"], {"dogs", "child", "zzz"})
    assert info["dogs"] == wd.EcdictInfo("dog", 0) and info["child"] == wd.EcdictInfo(None, 400) and "zzz" not in info


# ---- the book scan ----

def test_collect_wanted_uses_bookindex_keys_and_pos_order(env):
    wanted, dropped = wd.collect_wanted(env["books"])
    assert dropped == 1  # "a." is a POS abbreviation (BookIndex drops it too)
    assert wanted["abandon"].pos == ["v", "n"] and wanted["fast"].pos == ["a", "r"]
    assert wanted["child"].raw == {"Child"} and wanted["untyped"].untyped and "a." not in wanted


# ---- build ----

def test_build_picks_two_per_pos_in_sense_order_and_cleans_glosses(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["abandon"] == [("v", "forsake, leave behind", "oewn"),
                               ("v", "give up with the intent of never claiming again", "oewn"),
                               ("n", "the trait of lacking restraint", "oewn")]
    assert rows["stamp"] == [("n", "a small adhesive piece of paper", "oewn"), ("n", "an official mark", "oewn")]
    assert rows["big"] == [("a", "above average in size (more than usual) or number", "oewn")]
    assert rows["quick"] == [("a", "speedy", "oewn")] and rows["quickly"] == [("r", "with rapid movements", "oewn")]
    assert rows["ice cream"] == [("n", "a frozen dessert made from cream", "oewn")]


def test_build_resolves_lemmas_through_wordnet_exceptions_and_ecdict(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["went"] == [("v", "move away from a place", "oewn")]       # verb.exc
    assert rows["children"] == [("n", "a young person", "oewn")]            # noun.exc
    assert rows["dogs"] == [("n", "a domesticated canine", "oewn")]         # ECDICT exchange 0:dog


def test_build_never_uses_wordnet_for_closed_class_pos(env):
    run_build(env)
    rows = rows_of(env)
    assert rows["in"] == [("n", "a metallic element", "oewn")]  # the book says n too (indium); prep stays a gap
    assert "the" not in rows
    gaps = {g.word: g for g in wd.read_missing(env["out"] / "missing.txt")}
    assert gaps["in"].pos == ("prep",) and gaps["in"].category == "function"
    assert gaps["the"].pos == ("art",) and gaps["the"].category == "function"


def test_build_lists_gaps_with_categories_and_counts(env):
    result = run_build(env)
    gaps = {g.word: (g.pos, g.category) for g in wd.read_missing(env["out"] / "missing.txt")}
    assert gaps["america"] == (("n",), "proper") and gaps["tv"] == (("n",), "abbr") and gaps["mr."] == (("n",), "abbr")
    assert gaps["hard-working"] == (("a",), "compound") and gaps["sweaty"] == (("a",), "other")
    assert gaps["sketch"] == (("v",), "pos_mismatch")  # WordNet has sketch only as a noun
    assert gaps["untyped"] == (("-",), "other")
    assert "fast" not in gaps  # a found, r missing: a partial open-POS gap is counted, not listed
    assert result.stats["partial_open_pos"] == 1
    assert result.stats["gap_categories"] == {"function": 2, "proper": 1, "abbr": 2, "compound": 1, "pos_mismatch": 1, "other": 2}
    assert result.stats["words_wanted"] == 20 and result.stats["gaps"] == 9


def test_missing_txt_is_sorted_by_category_then_frequency(env):
    run_build(env)
    lines = (env["out"] / "missing.txt").read_text(encoding="utf-8").splitlines()
    assert [l.split("\t")[0] for l in lines][:2] == ["the", "in"]  # function, frq 1 before frq 6
    assert lines[0] == "the\tart\tfunction\t1"


def test_output_is_sorted_lf_utf8_and_valid(env):
    run_build(env)
    raw = (env["out"] / "definitions.jsonl").read_bytes()
    assert b"\r" not in raw and not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\n")
    words = [json.loads(l)["word"] for l in raw.decode("utf-8").splitlines()]
    assert words == sorted(words) and len(words) == len(set(words))
    assert wd.definitions_problems(env["out"] / "definitions.jsonl") == []


def test_build_is_byte_identical_across_runs_and_dates_only_move_with_content(env):
    run_build(env)
    first = {p.name: p.read_bytes() for p in env["out"].iterdir()}
    run_build(env)
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    wd.build(None, env["out"], env["books"], wordnet_zip=env["zip"], ecdict_path=env["db"])  # no --built: kept
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first


def test_manifest_matches_the_files_and_check_catches_tampering(env):
    run_build(env)
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    assert manifest["script_version"] == wd.SCRIPT_VERSION and manifest["built"] == "2026-10-12"
    assert [i["id"] for i in manifest["inputs"]] == ["oewn", "ecdict", "books"]
    assert manifest["inputs"][0]["license"] == "CC BY 4.0" and manifest["inputs"][1]["license"] == "MIT"
    entry = next(f for f in manifest["files"] if f["file"] == "definitions.jsonl")
    assert entry["entries"] == manifest["stats"]["words_with_defs"]
    assert wd.check(env["out"]) == []
    path = env["out"] / "definitions.jsonl"
    path.write_bytes(path.read_bytes() + b"\n")
    assert wd.check(env["out"]) == ["definitions.jsonl: size %d != %d" % (path.stat().st_size, entry["bytes"])]
    path.write_bytes(path.read_bytes()[:-1].replace(b"forsake", b"forsakE"))
    assert wd.check(env["out"]) == ["definitions.jsonl: sha256 mismatch"]
    (env["out"] / "SOURCE.json").unlink()
    assert wd.check(env["out"]) == ["SOURCE.json: missing"]


def test_definitions_problems_catches_schema_violations(tmp_path):
    bad = tmp_path / "definitions.jsonl"
    d = lambda pos, text="t", src="oewn": {"pos": pos, "text": text, "src": src}
    rows = [{"word": "b", "defs": [d("n")]}, {"word": "a", "defs": [d("n")]},            # unsorted
            {"word": "c", "defs": []}, {"word": "d", "defs": [d("zz")]}, {"word": "e", "defs": [d("n", "")]},
            {"word": "f", "defs": [d("n"), d("n"), d("n")]}, {"word": "g", "defs": [d("n", src="web")]},
            {"word": "Hello", "defs": [d("n")]}]
    bad.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    problems = wd.definitions_problems(bad)
    assert any("not sorted" in p for p in problems) and any("no defs" in p for p in problems)
    assert sum("bad def" in p for p in problems) == 3 and any("more than 2" in p for p in problems)
    assert any("bad word" in p for p in problems)


# ---- hand-written function words and the llm merge ----

def hand_file(env, rows):
    (env["out"]).mkdir(exist_ok=True)
    (env["out"] / "function-words.jsonl").write_text(
        "".join(json.dumps({"word": w, "defs": [{"pos": p, "text": t, "src": "hand"} for p, t in defs]}) + "\n"
                for w, defs in rows), encoding="utf-8")


def test_hand_entries_fill_closed_class_gaps_and_win_over_everything(env):
    hand_file(env, [("in", [("prep", "inside or within a place")]), ("stamp", [("n", "a mark made by pressing")]),
                    ("the", [("art", "used before a noun")])])
    result = run_build(env)
    rows = rows_of(env)
    assert rows["in"] == [("prep", "inside or within a place", "hand"), ("n", "a metallic element", "oewn")]  # book POS order
    assert rows["stamp"] == [("n", "a mark made by pressing", "hand")]  # hand beats oewn
    assert rows["the"] == [("art", "used before a noun", "hand")]
    assert result.stats["pairs"]["hand"] == 3 and result.stats["gap_categories"]["function"] == 0
    assert {f["file"] for f in json.loads((env["out"] / "SOURCE.json").read_text("utf-8"))["files"]} >= {"function-words.jsonl"}


@pytest.mark.parametrize("rows, message", [
    ([("zebra", [("n", "an animal")])], "words not in any book"),
    ([("in", [("v", "go inside")])], "POS the books do not give"),
])
def test_hand_file_mistakes_stop_the_build(env, rows, message):
    hand_file(env, rows)
    with pytest.raises(SystemExit, match=message):
        run_build(env)


@pytest.mark.parametrize("text", ["x" * 5 + " " + " ".join(["w"] * 13), "has 中文", "double  space", "", "multi\nline"])
def test_hand_text_rules_are_strict(env, text):
    hand_file(env, [("the", [("art", text)])])
    with pytest.raises(wd.ExtrasError):
        run_build(env)


def test_llm_rows_fill_only_what_oewn_and_hand_left_open(env):
    (env["out"]).mkdir(exist_ok=True)
    (env["out"] / "definitions-llm.jsonl").write_text(
        json.dumps({"word": "sweaty", "defs": [{"pos": "a", "text": "wet with sweat", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "stamp", "defs": [{"pos": "n", "text": "llm must not win", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "the", "defs": [{"pos": "art", "text": "used before a noun", "src": "llm"}]}) + "\n"
        + json.dumps({"word": "bad", "defs": [{"pos": "n", "text": "x " * 20, "src": "llm"}]}) + "\n", encoding="utf-8")
    result = run_build(env)
    rows = rows_of(env)
    assert rows["sweaty"] == [("a", "wet with sweat", "llm")] and rows["the"] == [("art", "used before a noun", "llm")]
    assert rows["stamp"][0][2] == "oewn" and "bad" not in rows
    assert result.stats["pairs"]["llm"] == 2
    assert "sweaty" not in {g.word for g in wd.read_missing(env["out"] / "missing.txt")}  # merged gaps leave the list


# ---- inputs and the command line ----

def test_verify_reports_missing_wrong_size_and_wrong_hash(tmp_path, monkeypatch):
    sources = tmp_path / "sources"
    (sources / "ewn").mkdir(parents=True)
    zip_path = make_wordnet_zip(sources / "ewn" / "english-wordnet-2025-index.sense-fixed.zip")
    problems = wd.verify(sources)
    assert problems[0].startswith("english-wordnet-2025-index.sense-fixed.zip: size") and problems[1] == "ecdict-sqlite-28.zip: missing"
    pinned = {**wd.INPUTS["oewn"], "bytes": zip_path.stat().st_size}
    monkeypatch.setitem(wd.INPUTS, "oewn", pinned)
    assert wd.verify(sources)[0].endswith("sha256 mismatch")
    monkeypatch.setitem(wd.INPUTS, "oewn", {**pinned, "sha256": wd.sha256_of(zip_path)})
    assert wd.verify(sources) == ["ecdict-sqlite-28.zip: missing"]
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py` → 新测试失败(`AttributeError: module ... has no attribute 'read_wordnet'`)。

- [ ] **Step 3: 实现** — 在脚本末尾追加:

````python
# ---------------------------------------------------------------- inputs: WordNet, ECDICT

_SS_POS = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
_DATA_POS = {"data.noun": "n", "data.verb": "v", "data.adj": "a", "data.adv": "r"}
_EXC_POS = {"noun.exc": "n", "verb.exc": "v", "adj.exc": "a", "adv.exc": "r"}


@dataclass
class WordNet:
    senses: dict[tuple[str, str], list[tuple[int, str]]] = field(default_factory=dict)  # (lemma, pos) -> [(sense_number, offset)]
    glosses: dict[tuple[str, str], str] = field(default_factory=dict)                  # (pos, offset) -> gloss
    exceptions: dict[tuple[str, str], list[str]] = field(default_factory=dict)         # (pos, inflected) -> lemmas

    def gloss_list(self, lemma: str, pos: str) -> list[str]:
        """Glosses of one lemma+POS in WordNet sense order (`tag_cnt` is 0 everywhere in this release)."""
        found = sorted(self.senses.get((lemma.replace(" ", "_"), pos), ()))
        return [self.glosses[(pos, off)] for _, off in found if (pos, off) in self.glosses]


def read_wordnet(zip_path: Path) -> WordNet:
    wn = WordNet()
    with zipfile.ZipFile(zip_path) as zf:
        members = {Path(i.filename).name: i for i in zf.infolist() if not i.is_dir()}

        def lines(name: str):
            with zf.open(members[name]) as raw:
                for line in raw.read().decode("utf-8").split("\n"):
                    yield line.rstrip("\r")

        for line in lines("index.sense"):
            parts = line.split()
            if len(parts) != 4:
                continue
            lemma, _, rest = parts[0].rpartition("%")
            pos = _SS_POS.get(rest.split(":", 1)[0])
            if pos:
                wn.senses.setdefault((lemma, pos), []).append((int(parts[2]), parts[1]))
        for name, pos in _DATA_POS.items():
            for line in lines(name):
                if line.startswith("  ") or not line.strip():  # license header
                    continue
                head, sep, gloss = line.partition(" | ")
                if sep and head.split():
                    wn.glosses[(pos, head.split()[0])] = gloss.strip()
        for name, pos in _EXC_POS.items():
            if name not in members:
                continue
            for line in lines(name):
                parts = line.split()
                if len(parts) >= 2:
                    wn.exceptions[(pos, parts[0])] = parts[1:]
    return wn


@dataclass(frozen=True)
class EcdictInfo:
    lemma: str | None
    frq: int


def parse_exchange(exchange: str | None) -> str | None:
    """`exchange` is 'p:went/d:gone/0:go/1:p' -> the lemma ('go'), or None."""
    for item in (exchange or "").split("/"):
        key, _, value = item.partition(":")
        if key == "0" and value.strip():
            return value.strip().lower()
    return None


def read_ecdict(db_path: Path, words: set[str]) -> dict[str, EcdictInfo]:
    """Lemma + frequency rank (`frq`, smaller = commoner, 0 = unknown) for the wanted words only."""
    out: dict[str, EcdictInfo] = {}
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        for word, exchange, frq in con.execute("select word, exchange, frq from stardict order by rowid"):
            low = (word or "").lower()
            if low in words and (low not in out or word == low):  # the exact lower-case row wins
                out[low] = EcdictInfo(parse_exchange(exchange), int(frq or 0))
    finally:
        con.close()
    return out



# ---------------------------------------------------------------- the word books

@dataclass
class WordInfo:
    key: str
    raw: set[str] = field(default_factory=set)
    pos: list[str] = field(default_factory=list)
    abbr: bool = False       # a book row typed it 'abbr'
    untyped: bool = False    # some row had no usable POS token


def collect_wanted(books_dir: Path, book_ids: tuple[str, ...] = BOOK_IDS) -> tuple[dict[str, WordInfo], int]:
    """(key -> WordInfo in first-seen order, number of rows BookIndex would drop). Keys equal BookIndex keys."""
    wanted: dict[str, WordInfo] = {}
    dropped = 0
    for book in book_ids:
        with (books_dir / f"{book}.jsonl").open("rb") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                key = headword_key(row.get("word", ""))
                if key is None:
                    dropped += 1
                    continue
                info = wanted.setdefault(key, WordInfo(key))
                info.raw.add((row.get("word") or "").strip())
                types = [t.get("type") for t in row.get("translations") or []]
                if not types:
                    info.untyped = True
                for type_str in types:
                    mapped = map_pos(type_str)
                    if "abbr" in pos_tokens(type_str):
                        info.abbr = True
                    if not mapped:
                        info.untyped = True
                    for pos in mapped:
                        if pos not in info.pos:
                            info.pos.append(pos)
    return wanted, dropped



# ---------------------------------------------------------------- extras (hand / llm)

class ExtrasError(ValueError):
    pass


def validate_def(pos: str, text: str, src: str) -> str | None:
    """Reason a hand / llm definition is unusable, else None."""
    if pos not in ALL_POS:
        return "pos"
    if not isinstance(text, str) or not text.strip() or text != " ".join(text.split()):
        return "text"
    if re.search(r"[\u3400-\u9fff\uf900-\ufaff]", text) or "\n" in text:
        return "cjk"
    if len(text.split()) > LLM_MAX_WORDS:
        return "long"
    if src not in ("hand", "llm"):
        return "src"
    return None


def read_extras(path: Path, src: str, *, strict: bool) -> dict[str, dict[str, list[str]]]:
    """word -> pos -> texts from function-words.jsonl (strict: any problem raises) or definitions-llm.jsonl."""
    out: dict[str, dict[str, list[str]]] = {}
    if not path.is_file():
        return out
    for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            word, defs = row["word"], row["defs"]
            for d in defs:
                reason = validate_def(d["pos"], d["text"], src)
                if reason or d.get("src") != src:
                    raise ExtrasError(f"{path.name}:{number}: bad def ({reason or 'src'})")
                bucket = out.setdefault(word, {}).setdefault(d["pos"], [])
                if d["text"] not in bucket:
                    bucket.append(d["text"])
        except (KeyError, TypeError, ValueError) as e:
            if strict:
                raise ExtrasError(f"{path.name}:{number}: {type(e).__name__}") from None
    return out



# ---------------------------------------------------------------- build

@dataclass(frozen=True)
class Gap:
    word: str
    pos: tuple[str, ...]
    category: str
    frq: int


@dataclass
class BuildResult:
    entries: list[tuple[str, list[dict]]]
    gaps: list[Gap]
    stats: dict


def find_defs(wn: WordNet, word: str, pos: str, lemma_hint: str | None) -> list[str]:
    """Exact lemma first, then WordNet's irregular-form list, then ECDICT's lemma (one hop)."""
    candidates = [word, *wn.exceptions.get((pos, word), ())]
    if lemma_hint:
        candidates.append(lemma_hint)
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        texts = pick_texts(wn.gloss_list(candidate, pos))
        if texts:
            return texts
    return []


def _has_other_pos(wn: WordNet, word: str, lemma_hint: str | None) -> bool:
    names = {word, *(l for p in OPEN_POS for l in wn.exceptions.get((p, word), ())), *([lemma_hint] if lemma_hint else [])}
    return any(wn.senses.get((n.replace(" ", "_"), p)) for n in names for p in OPEN_POS)


def categorize(info: WordInfo, missing_pos: list[str], other_pos_exists: bool) -> str:
    if any(p in CLOSED_POS for p in missing_pos):
        return "function"
    raws = info.raw or {info.key}
    if info.abbr or any("." in r or (len(r) >= 2 and r.isupper()) for r in raws):
        return "abbr"
    if any(r[:1].isupper() for r in raws):
        return "proper"
    if " " in info.key or "-" in info.key:
        return "compound"
    if other_pos_exists:
        return "pos_mismatch"
    return "other"


def build_entries(wanted: dict[str, WordInfo], wn: WordNet, ecdict: dict[str, EcdictInfo],
                  hand: dict[str, dict[str, list[str]]], llm: dict[str, dict[str, list[str]]]) -> BuildResult:
    """Merge per (word, POS): hand > oewn > llm. Closed-class POS never read WordNet (spec §2)."""
    entries: list[tuple[str, list[dict]]] = []
    gaps: list[Gap] = []
    src_pairs: collections.Counter = collections.Counter()
    words_with_oewn = partial_open = 0
    for key in sorted(wanted):
        info = wanted[key]
        hint = ecdict.get(key).lemma if key in ecdict else None
        defs: list[dict] = []
        missing: list[str] = []
        used_oewn = False
        for pos in info.pos:
            found, src = [], ""
            if hand.get(key, {}).get(pos):
                found, src = hand[key][pos][:MAX_PER_POS], "hand"
            elif pos in OPEN_POS and (texts := find_defs(wn, key, pos, hint)):
                found, src = texts, "oewn"
            elif llm.get(key, {}).get(pos):
                found, src = llm[key][pos][:MAX_PER_POS], "llm"
            if not found:
                missing.append(pos)
                continue
            used_oewn = used_oewn or src == "oewn"
            src_pairs[src] += 1
            defs.extend({"pos": pos, "text": text, "src": src} for text in found)
        words_with_oewn += used_oewn
        if defs:
            entries.append((key, defs))
        closed_missing = [p for p in missing if p in CLOSED_POS]
        if defs and missing and not closed_missing:
            partial_open += 1  # e.g. a noun+verb word that WordNet only has as a noun: no English line for the verb
        if not defs or closed_missing:
            gap_pos = missing if not defs else closed_missing
            gaps.append(Gap(key, tuple(gap_pos) or ("-",), categorize(info, gap_pos, _has_other_pos(wn, key, hint)),
                            ecdict[key].frq if key in ecdict else 0))
    order = {c: i for i, c in enumerate(CATEGORIES)}
    gaps.sort(key=lambda g: (order[g.category], g.frq <= 0, g.frq, g.word))
    stats = {
        "words_wanted": len(wanted), "words_with_defs": len(entries), "words_with_oewn": words_with_oewn,
        "defs": sum(len(d) for _, d in entries),
        "pairs": {s: src_pairs.get(s, 0) for s in SRC_VALUES},
        "partial_open_pos": partial_open, "gaps": len(gaps), "gap_categories": {c: sum(1 for g in gaps if g.category == c) for c in CATEGORIES},
    }
    return BuildResult(entries, gaps, stats)


def render_definitions(entries: list[tuple[str, list[dict]]]) -> bytes:
    return "".join(dump_line({"word": w, "defs": d}) + "\n" for w, d in entries).encode("utf-8")


def render_missing(gaps: list[Gap]) -> bytes:
    return "".join(f"{g.word}\t{','.join(g.pos)}\t{g.category}\t{g.frq}\n" for g in gaps).encode("utf-8")


def read_missing(path: Path) -> list[Gap]:
    out = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            word, pos, category, frq = line.split("\t")
            out.append(Gap(word, tuple(pos.split(",")), category, int(frq)))
    return out



# ---------------------------------------------------------------- sources layout, verify

def find_file(root: Path, name: str) -> Path | None:
    hits = sorted(p for p in root.rglob(name) if p.is_file())
    return hits[0] if hits else None


def verify(root: Path) -> list[str]:
    """Problems with the pinned input zips found under `root` (empty list = ok)."""
    problems = []
    for spec in INPUTS.values():
        path = find_file(root, spec["file"])
        if path is None:
            problems.append(f"{spec['file']}: missing")
        elif path.stat().st_size != spec["bytes"]:
            problems.append(f"{spec['file']}: size {path.stat().st_size} != {spec['bytes']}")
        elif sha256_of(path) != spec["sha256"]:
            problems.append(f"{spec['file']}: sha256 mismatch")
    return problems


def ecdict_db(root: Path, work: Path) -> Path:
    """An already extracted stardict.db under root of the right size, else extract the zip into `work`."""
    for hit in sorted(root.rglob(ECDICT_DB)):
        if hit.is_file() and hit.stat().st_size == ECDICT_DB_BYTES:
            return hit
    zip_path = find_file(root, INPUTS["ecdict"]["file"])
    if zip_path is None:
        raise SystemExit("ecdict: stardict.db and ecdict-sqlite-28.zip both missing")
    target = work / ECDICT_DB
    if not (target.is_file() and target.stat().st_size == ECDICT_DB_BYTES):
        work.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extract(ECDICT_DB, work)
    return target



# ---------------------------------------------------------------- manifest / build / check

def _file_entry(path: Path, **extra) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256_of(path), **extra}


def _line_count(path: Path) -> int:
    return sum(1 for line in path.read_bytes().split(b"\n") if line.strip())


def build_manifest(data_dir: Path, result: BuildResult, built: str, books_manifest_sha: str) -> dict:
    files = [_file_entry(data_dir / FILES["definitions"], entries=len(result.entries)),
             _file_entry(data_dir / FILES["missing"], entries=len(result.gaps))]
    for key in ("hand", "llm"):
        if (data_dir / FILES[key]).is_file():
            files.append(_file_entry(data_dir / FILES[key], entries=_line_count(data_dir / FILES[key])))
    return {
        "schema": 1, "script": "scripts/wordbook_definitions.py", "script_version": SCRIPT_VERSION, "built": built,
        "inputs": [{"id": i, **{k: v for k, v in spec.items()}} for i, spec in INPUTS.items()]
                  + [{"id": "books", "name": "kylebing-english-vocabulary", "manifest_sha256": books_manifest_sha}],
        "rules": {"max_per_pos": MAX_PER_POS, "long_gloss_words": LONG_GLOSS_WORDS, "max_paren_words": MAX_PAREN_WORDS,
                  "sense_order": "sense_number", "closed_pos_from_wordnet": False},
        "files": files, "stats": result.stats,
    }


def build(sources: Path | None, data_dir: Path = DATA_DIR, books_dir: Path = BOOKS_DIR, *, built: str | None = None,
          work: Path | None = None, wordnet_zip: Path | None = None, ecdict_path: Path | None = None) -> BuildResult:
    """Write definitions.jsonl, missing.txt and SOURCE.json into `data_dir`. `wordnet_zip` / `ecdict_path` override
    the discovery under `sources` (tests use small fixtures)."""
    wanted, _ = collect_wanted(books_dir)
    if wordnet_zip is None:
        zip_path = find_file(sources, INPUTS["oewn"]["file"]) if sources else None
        if zip_path is None:
            raise SystemExit("oewn zip not found; pass --sources or set WORDBOOK_DEFS_SOURCES")
        wordnet_zip = zip_path
    if ecdict_path is None:
        ecdict_path = ecdict_db(sources, work or Path(tempfile.gettempdir()) / "wordbook-defs-work")
    wn = read_wordnet(wordnet_zip)
    ecdict = read_ecdict(ecdict_path, set(wanted))
    hand = read_extras(data_dir / FILES["hand"], "hand", strict=True)
    unknown = sorted(w for w in hand if w not in wanted)
    if unknown:
        raise SystemExit(f"{FILES['hand']}: words not in any book: {', '.join(unknown[:10])}")
    stray = sorted(f"{w}:{p}" for w, by_pos in hand.items() for p in by_pos if p not in wanted[w].pos)
    if stray:
        raise SystemExit(f"{FILES['hand']}: POS the books do not give the word: {', '.join(stray[:10])}")
    llm = read_extras(data_dir / FILES["llm"], "llm", strict=False)
    result = build_entries(wanted, wn, ecdict, hand, llm)
    write_bytes(data_dir / FILES["definitions"], render_definitions(result.entries))
    write_bytes(data_dir / FILES["missing"], render_missing(result.gaps))
    manifest_path = data_dir / FILES["manifest"]
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    same = any(f.get("file") == FILES["definitions"] and f.get("sha256") == sha256_of(data_dir / FILES["definitions"])
               for f in previous.get("files", []))
    day = built or (previous.get("built") if same else None) or datetime.now(timezone.utc).date().isoformat()
    date.fromisoformat(day)
    books_sha = sha256_of(books_dir / "SOURCE.json") if (books_dir / "SOURCE.json").is_file() else ""
    manifest = build_manifest(data_dir, result, day, books_sha)
    write_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return result


def check(data_dir: Path = DATA_DIR) -> list[str]:
    """SOURCE.json vs the files next to it, plus the schema rules of definitions.jsonl (empty list = ok)."""
    manifest_path = data_dir / FILES["manifest"]
    if not manifest_path.is_file():
        return ["SOURCE.json: missing"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    problems = []
    for entry in manifest["files"]:
        path = data_dir / entry["file"]
        if not path.is_file():
            problems.append(f"{entry['file']}: missing")
        elif path.stat().st_size != entry["bytes"]:
            problems.append(f"{entry['file']}: size {path.stat().st_size} != {entry['bytes']}")
        elif sha256_of(path) != entry["sha256"]:
            problems.append(f"{entry['file']}: sha256 mismatch")
        elif entry["file"].endswith((".jsonl", ".txt")) and _line_count(path) != entry["entries"]:
            problems.append(f"{entry['file']}: entries {_line_count(path)} != {entry['entries']}")
    problems += definitions_problems(data_dir / FILES["definitions"])
    return problems


def definitions_problems(path: Path) -> list[str]:
    """Schema rules the runtime loader relies on."""
    if not path.is_file():
        return [f"{path.name}: missing"]
    problems, previous = [], ""
    for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if not line:
            continue
        row = json.loads(line)
        word, defs = row.get("word"), row.get("defs")
        if not isinstance(word, str) or word != word.lower() or headword_key(word) != word:
            problems.append(f"line {number}: bad word")
        elif word <= previous:
            problems.append(f"line {number}: not sorted ({word})")
        previous = word if isinstance(word, str) else previous
        if not defs:
            problems.append(f"line {number}: no defs ({word})")
            continue
        per_pos = collections.Counter()
        for d in defs:
            per_pos[d.get("pos")] += 1
            if d.get("pos") not in ALL_POS or d.get("src") not in SRC_VALUES or not str(d.get("text", "")).strip():
                problems.append(f"line {number}: bad def ({word})")
        if any(n > MAX_PER_POS for n in per_pos.values()):
            problems.append(f"line {number}: more than {MAX_PER_POS} per POS ({word})")
    return problems
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```
git add server/scripts/wordbook_definitions.py server/tests/test_wordbook_definitions_build.py
git commit -m "feat(server): build wordbook definitions from WordNet with lemma resolution, gap list and manifest" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task B3: `llm-fill`(代码随功能一起交付;**真正运行 BLOCKED,见 L1**)

> 上游 LLM 现在回 402。本任务的代码和测试全部用假模型,不需要余额;它能合并、能断点续跑、能在 402 时干净地停。没有它的数据功能照常工作(缺口词不显示英文释义)。

**Files:**
- Modify: `server/scripts/wordbook_definitions.py`(追加第三部分)
- Modify: `server/tests/test_wordbook_definitions_build.py`(追加)

**Interfaces:**
- Produces:`LlmClient`(协议:`async complete(messages) -> str`)、`LlmStopped(status, kind)`、`SYSTEM_PROMPT`、`llm_candidates(gaps, done)`、`make_batches(gaps, size=40)`、`build_messages(batch)`、`parse_reply(text, batch)`、`read_llm_rows`、`write_llm_rows`、`run_fill(client, gaps, out_path, *, size, max_batches) -> dict`、`spot_check(path, pct=5, seed=20261012)`、`RealLlm`(开发机用,经 `app.providers.llm.complete`)。

- [ ] **Step 1: 追加失败测试** — 假模型 `FakeLlm`;覆盖:候选过滤、40 词一批、提示词只含词和词性、严格解析(围栏、前后有话、重复词性、多余词性、13 词、中文、缺字段)、写出文件排序、402 后断点续跑且不重复问、坏回复计数并留队、`max_batches`、5% 抽样稳定、`fill → build` 合并、真实客户端把 402 变成干净停止:

````python
# ---- llm-fill with a fake model ----

class FakeLlm:
    def __init__(self, replies=None, stop_after=None):
        self.calls, self.replies, self.stop_after = [], replies or {}, stop_after

    async def complete(self, messages):
        self.calls.append(messages)
        if self.stop_after is not None and len(self.calls) > self.stop_after:
            raise wd.LlmStopped(402, "http")
        asked = json.loads(messages[-1]["content"])
        reply = self.replies.get(len(self.calls))
        if reply is not None:
            return reply
        return json.dumps([{"word": a["word"], "defs": [{"pos": p, "text": f"meaning of {a['word']} as {p}"} for p in a["pos"]]}
                           for a in asked])


def gap(word, pos=("n",), category="other", frq=0):
    return wd.Gap(word, pos, category, frq)


def test_candidates_skip_proper_nouns_abbreviations_unknown_pos_and_done_words():
    gaps = [gap("a1"), gap("a2", category="proper"), gap("a3", category="abbr"), gap("a4", ("-",)), gap("a5"),
            gap("a6", ("prep",), "function")]
    assert [g.word for g in wd.llm_candidates(gaps, {"a5"})] == ["a1", "a6"]


def test_batches_are_forty_words():
    batches = wd.make_batches([gap(f"w{i:03d}") for i in range(85)])
    assert [len(b) for b in batches] == [40, 40, 5] and wd.LLM_BATCH == 40


def test_prompt_is_json_only_and_carries_word_and_pos_only():
    messages = wd.build_messages([gap("sweaty", ("a",)), gap("for", ("prep", "conj"), "function")])
    assert messages[0]["role"] == "system" and "at most 12 words" in messages[0]["content"] and "JSON only" in messages[0]["content"]
    assert json.loads(messages[1]["content"]) == [{"word": "sweaty", "pos": ["a"]}, {"word": "for", "pos": ["prep", "conj"]}]


def test_parse_reply_is_strict():
    batch = [gap("sweaty", ("a",)), gap("for", ("prep", "conj"), "function"), gap("eke", ("v",))]
    good = [{"word": "sweaty", "defs": [{"pos": "a", "text": "wet with sweat"}]}]
    assert wd.parse_reply(json.dumps(good), batch)["sweaty"] == [{"pos": "a", "text": "wet with sweat", "src": "llm"}]
    assert wd.parse_reply("```json\n" + json.dumps(good) + "\n```", batch).keys() == {"sweaty"}
    assert wd.parse_reply("Sure! " + json.dumps(good), batch) == {}                       # prose around the JSON
    assert wd.parse_reply('{"word": "sweaty"}', batch) == {} and wd.parse_reply("", batch) == {}
    reject = [
        {"word": "other", "defs": [{"pos": "a", "text": "x"}]},                              # not asked
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}]},                              # a POS missing
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}, {"pos": "prep", "text": "y"}]},  # a POS twice
        {"word": "for", "defs": [{"pos": "prep", "text": "x"}, {"pos": "n", "text": "y"}]},     # a POS not asked
        {"word": "eke", "defs": [{"pos": "v", "text": " ".join(["w"] * 13)}]},                 # 13 words
        {"word": "eke", "defs": [{"pos": "v", "text": "中文"}]},
        {"word": "eke", "defs": [{"pos": "v"}]}, {"word": "eke", "defs": "x"}, "junk", None]
    assert wd.parse_reply(json.dumps(reject), batch) == {}
    both = wd.parse_reply(json.dumps([{"word": "for", "defs": [{"pos": "conj", "text": "because"}, {"pos": "prep", "text": "to help"}]}]), batch)
    assert [d["pos"] for d in both["for"]] == ["prep", "conj"]  # asked order


def test_run_fill_writes_sorted_rows_and_reports(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap(f"w{i:03d}") for i in range(85)]
    llm = FakeLlm()
    report = asyncio.run(wd.run_fill(llm, gaps, out))
    assert report == {"candidates": 85, "batches": 3, "filled": 85, "rejected_words": 0, "bad_batches": 0}
    rows = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines()]
    assert [r["word"] for r in rows] == sorted(r["word"] for r in rows) and len(rows) == 85
    assert all(d["src"] == "llm" for r in rows for d in r["defs"])
    assert b"\r" not in out.read_bytes()


def test_run_fill_resumes_after_a_402_and_never_repeats_a_word(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap(f"w{i:03d}") for i in range(85)]
    first = FakeLlm(stop_after=1)  # the second call answers 402
    with pytest.raises(wd.LlmStopped) as caught:
        asyncio.run(wd.run_fill(first, gaps, out))
    assert caught.value.status == 402 and len(first.calls) == 2
    assert len(out.read_text(encoding="utf-8").splitlines()) == 40  # progress kept
    second = FakeLlm()
    report = asyncio.run(wd.run_fill(second, gaps, out))
    assert report["candidates"] == 45 and report["filled"] == 45 and len(second.calls) == 2
    asked = {a["word"] for call in first.calls[:1] + second.calls for a in json.loads(call[-1]["content"])}
    assert len(asked) == 85 and len(out.read_text(encoding="utf-8").splitlines()) == 85


def test_run_fill_counts_bad_replies_and_keeps_those_words_queued(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    gaps = [gap("aaa"), gap("bbb")]
    report = asyncio.run(wd.run_fill(FakeLlm({1: "not json"}), gaps, out))
    assert report["bad_batches"] == 1 and report["filled"] == 0 and not out.exists() or out.read_text(encoding="utf-8") == ""
    report = asyncio.run(wd.run_fill(FakeLlm(), gaps, out))
    assert report["filled"] == 2


def test_run_fill_max_batches(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    llm = FakeLlm()
    report = asyncio.run(wd.run_fill(llm, [gap(f"w{i:03d}") for i in range(85)], out, max_batches=1))
    assert report["batches"] == 1 and len(llm.calls) == 1 and len(out.read_text(encoding="utf-8").splitlines()) == 40


def test_spot_check_is_a_stable_five_percent_sample(tmp_path):
    out = tmp_path / "definitions-llm.jsonl"
    asyncio.run(wd.run_fill(FakeLlm(), [gap(f"w{i:03d}") for i in range(100)], out))
    sample = wd.spot_check(out)
    assert len(sample) == 5 and sample == wd.spot_check(out) and sample == sorted(sample)
    assert wd.spot_check(tmp_path / "none.jsonl") == []


def test_fill_then_build_merges_the_filled_words(env):
    run_build(env)
    gaps = wd.read_missing(env["out"] / "missing.txt")
    asyncio.run(wd.run_fill(FakeLlm(), gaps, env["out"] / "definitions-llm.jsonl"))
    result = run_build(env)
    rows = rows_of(env)
    assert rows["sweaty"] == [("a", "meaning of sweaty as a", "llm")] and rows["the"][0][2] == "llm"
    assert "america" not in rows and "tv" not in rows  # proper nouns / abbreviations are never sent
    assert result.stats["gap_categories"]["function"] == 0 and result.stats["gap_categories"]["other"] == 1  # only the word with no POS
    assert wd.check(env["out"]) == []


# ---- the real client (only the mapping; nothing is ever sent for real) ----

@respx.mock
async def test_real_client_turns_a_402_into_a_clean_stop_and_returns_text_on_200(monkeypatch):
    monkeypatch.setenv("UPSTREAM_LLM_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("UPSTREAM_LLM_KEY", "test-key")
    route = respx.post("https://llm.example.test/v1/chat/completions")
    client = wd.RealLlm()
    try:
        route.mock(return_value=httpx.Response(402, json={"error": "insufficient balance"}))
        with pytest.raises(wd.LlmStopped) as caught:
            await client.complete([{"role": "user", "content": "[]"}])
        assert caught.value.status == 402
        route.mock(return_value=httpx.Response(200, json={"choices": [{"message": {"content": "[]"}}]}))
        assert await client.complete([{"role": "user", "content": "[]"}]) == "[]"
    finally:
        await client.aclose()
        METER.drain()
````

- [ ] **Step 2: 运行确认失败** — `uv run pytest -q tests/test_wordbook_definitions_build.py` → 新测试失败(`AttributeError: ... 'Gap'`/`'run_fill'`)。

- [ ] **Step 3: 实现** — 在脚本末尾追加:

````python
# ---------------------------------------------------------------- llm-fill

class LlmClient(Protocol):
    async def complete(self, messages: list[dict]) -> str: ...


class LlmStopped(Exception):
    """The upstream refused (balance / config / network): stop at once, keep the progress."""

    def __init__(self, status: int = 0, kind: str = ""):
        super().__init__(f"{kind or 'http'} {status}")
        self.status, self.kind = status, kind


SYSTEM_PROMPT = (
    "You write short English dictionary definitions for a learner's word list (CEFR A2-B1 vocabulary). "
    "For each word and each part of speech listed, write exactly one definition of at most 12 words that uses "
    "simple common words and does not repeat the headword. Part-of-speech codes: n noun, v verb, a adjective, "
    "r adverb, prep preposition, pron pronoun or determiner, conj conjunction, art article, num numeral, "
    "aux auxiliary or modal verb, int interjection. Reply with JSON only, no prose and no code fences: "
    '[{"word": "...", "defs": [{"pos": "...", "text": "..."}]}]. Keep the word and pos values exactly as given.')


def llm_candidates(gaps: list[Gap], done: set[str]) -> list[Gap]:
    """Gaps worth a model call: everything except proper nouns and abbreviations, not yet filled, with a known POS."""
    return [g for g in gaps if g.category not in ("proper", "abbr") and g.word not in done and "-" not in g.pos]


def make_batches(gaps: list[Gap], size: int = LLM_BATCH) -> list[list[Gap]]:
    return [gaps[i:i + size] for i in range(0, len(gaps), size)]


def build_messages(batch: list[Gap]) -> list[dict]:
    payload = json.dumps([{"word": g.word, "pos": list(g.pos)} for g in batch], ensure_ascii=False)
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": payload}]


_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.S)


def parse_reply(text: str, batch: list[Gap]) -> dict[str, list[dict]]:
    """Strict: a JSON array (one optional fenced block tolerated). Returns only fully valid words: requested word,
    exactly one def per requested POS, no extra POS, valid text. Anything else is dropped (it stays in the queue)."""
    body = (text or "").strip()
    fenced = _FENCE.match(body)
    try:
        rows = json.loads(fenced.group(1) if fenced else body)
    except ValueError:
        return {}
    if not isinstance(rows, list):
        return {}
    asked = {g.word: g.pos for g in batch}
    out: dict[str, list[dict]] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("word") not in asked or row["word"] in out:
            continue
        defs = row.get("defs")
        if not isinstance(defs, list) or len(defs) != len(asked[row["word"]]):
            continue
        good, seen = [], set()
        for d in defs:
            if not isinstance(d, dict) or d.get("pos") not in asked[row["word"]] or d["pos"] in seen:
                break
            if validate_def(d["pos"], d.get("text"), "llm"):
                break
            seen.add(d["pos"])
            good.append({"pos": d["pos"], "text": d["text"], "src": "llm"})
        else:
            out[row["word"]] = sorted(good, key=lambda d: asked[row["word"]].index(d["pos"]))
    return out


def read_llm_rows(path: Path) -> dict[str, list[dict]]:
    rows: dict[str, list[dict]] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                row = json.loads(line)
                rows[row["word"]] = row["defs"]
    return rows


def write_llm_rows(path: Path, rows: dict[str, list[dict]]) -> None:
    write_bytes(path, "".join(dump_line({"word": w, "defs": rows[w]}) + "\n" for w in sorted(rows)).encode("utf-8"))


async def run_fill(client: LlmClient, gaps: list[Gap], out_path: Path, *, size: int = LLM_BATCH,
                   max_batches: int | None = None) -> dict:
    """Resumable: words already in `out_path` are skipped, the file is rewritten (sorted) after every batch.
    LlmStopped propagates after the progress is saved. A batch whose reply is unusable is counted and skipped."""
    rows = read_llm_rows(out_path)
    todo = llm_candidates(gaps, set(rows))
    report = {"candidates": len(todo), "batches": 0, "filled": 0, "rejected_words": 0, "bad_batches": 0}
    for batch in make_batches(todo, size):
        if max_batches is not None and report["batches"] >= max_batches:
            break
        report["batches"] += 1
        reply = await client.complete(build_messages(batch))  # may raise LlmStopped
        good = parse_reply(reply, batch)
        if not good:
            report["bad_batches"] += 1
        report["filled"] += len(good)
        report["rejected_words"] += len(batch) - len(good)
        rows.update(good)
        write_llm_rows(out_path, rows)
    return report


def spot_check(llm_path: Path, pct: int = SPOT_CHECK_PCT, seed: int = 20261012) -> list[tuple[str, str, str]]:
    """Deterministic ~pct% sample of (word, pos, text) for the human review."""
    flat = [(w, d["pos"], d["text"]) for w, defs in sorted(read_llm_rows(llm_path).items()) for d in defs]
    if not flat:
        return []
    return sorted(random.Random(seed).sample(flat, max(1, round(len(flat) * pct / 100))))


class RealLlm:
    """Dev-machine client through the server's own LLM provider settings (server/.env)."""

    def __init__(self):
        import httpx
        from app.core.config import Settings
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
        self._settings = Settings()

    async def complete(self, messages: list[dict]) -> str:
        from app.providers import llm
        try:
            return await llm.complete(self._http, self._settings, messages, model=self._settings.default_llm_model,
                                      max_tokens=4000, temperature=0.2, timeout=120.0)
        except llm.LlmUnavailable as e:
            raise LlmStopped(e.status, e.kind) from None

    async def aclose(self) -> None:
        await self._http.aclose()
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿。

- [ ] **Step 5: 提交**

```
git add server/scripts/wordbook_definitions.py server/tests/test_wordbook_definitions_build.py
git commit -m "feat(server): resumable llm-fill for wordbook definition gaps (strict JSON, fake-LLM tested)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task B4: 命令行

**Files:**
- Modify: `server/scripts/wordbook_definitions.py`(追加第四部分)
- Modify: `server/tests/test_wordbook_definitions_build.py`(追加)

**Interfaces:**
- Produces:`main(argv)`:`verify`、`build`(先 `verify`,失败就退出 1 并打印问题)、`check`、`llm-fill`(退出码 0 / 3 = 上游拒绝)。`--sources`(默认环境变量 `WORDBOOK_DEFS_SOURCES`)、`--data-dir`、`--books-dir`、`--work`、`--built`、`--max-batches`、`--report`。

- [ ] **Step 1: 追加失败测试**:

````python
def test_cli_check_and_missing_sources_message(env, capsys, monkeypatch):
    run_build(env)
    assert wd.main(["check", "--data-dir", str(env["out"])]) == 0 and capsys.readouterr().out.strip() == "ok"
    monkeypatch.delenv("WORDBOOK_DEFS_SOURCES", raising=False)
    with pytest.raises(SystemExit, match="WORDBOOK_DEFS_SOURCES"):
        wd.main(["verify"])
    monkeypatch.setenv("WORDBOOK_DEFS_SOURCES", str(env["out"]))
    assert wd.main(["verify"]) == 1 and "missing" in capsys.readouterr().out


def test_the_script_is_not_imported_by_the_app():
    for path in (SERVER / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "import wordbook_definitions" not in text and "scripts.wordbook_definitions" not in text, path
````

- [ ] **Step 2: 运行确认失败** — 新测试失败(`AttributeError: ... 'main'`)。

- [ ] **Step 3: 实现** — 在脚本末尾追加:

````python
# ---------------------------------------------------------------- cli

def _sources_arg(value: str | None) -> Path | None:
    raw = value or os.environ.get("WORDBOOK_DEFS_SOURCES")
    return Path(raw) if raw else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("verify", "build", "check", "llm-fill"))
    parser.add_argument("--sources", help="dir holding the two input zips (default: env WORDBOOK_DEFS_SOURCES)")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--books-dir", type=Path, default=BOOKS_DIR)
    parser.add_argument("--work", type=Path, help="scratch dir for the extracted stardict.db")
    parser.add_argument("--built", help="YYYY-MM-DD written to SOURCE.json (default: kept when the output is unchanged)")
    parser.add_argument("--max-batches", type=int, help="llm-fill: stop after N batches")
    parser.add_argument("--report", type=Path, help="llm-fill: spot-check report path")
    args = parser.parse_args(argv)
    sources = _sources_arg(args.sources)
    if args.command == "check":
        problems = check(args.data_dir)
    elif args.command == "verify":
        if sources is None:
            raise SystemExit("pass --sources or set WORDBOOK_DEFS_SOURCES")
        problems = verify(sources)
    elif args.command == "build":
        if sources is None:
            raise SystemExit("pass --sources or set WORDBOOK_DEFS_SOURCES")
        if problems := verify(sources):
            print("\n".join(problems))
            return 1
        stats = build(sources, args.data_dir, args.books_dir, built=args.built, work=args.work).stats
        print(json.dumps(stats, indent=2))
        return 0
    else:
        return _llm_fill_cli(args)
    print("\n".join(problems) if problems else "ok")
    return 1 if problems else 0


def _llm_fill_cli(args) -> int:
    missing = args.data_dir / FILES["missing"]
    if not missing.is_file():
        raise SystemExit("run `build` first: missing.txt not found")
    out = args.data_dir / FILES["llm"]
    client = RealLlm()

    async def go() -> dict:
        try:
            return await run_fill(client, read_missing(missing), out, max_batches=args.max_batches)
        finally:
            await client.aclose()

    try:
        report = asyncio.run(go())
    except LlmStopped as e:
        print(f"llm-fill stopped: upstream answered {e.kind or 'http'} {e.status}; progress kept, run again later")
        return 3
    print(json.dumps(report))
    sample = spot_check(out)
    path = args.report or Path(tempfile.gettempdir()) / "wordbook-defs-llm-spotcheck.txt"
    write_bytes(path, "".join(f"{w}\t{p}\t{t}\n" for w, p, t in sample).encode("utf-8"))
    print(f"spot-check sample ({len(sample)} defs): {path}; review it, then run `build` to merge")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿(此时除最后一个手写表测试之外的 83 个;手写表测试在 D1 追加)。

- [ ] **Step 5: 提交**

```
git add server/scripts/wordbook_definitions.py server/tests/test_wordbook_definitions_build.py
git commit -m "feat(server): wordbook definitions command line (verify, build, check, llm-fill)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Lane R/P · 运行时、偏好、契约

### Task R1: 释义加载器与 `select_defs`(纯,只用标准库)

**Files:**
- Create: `server/app/wordbook/definitions.py`
- Create: `server/tests/test_wordbook_definitions.py`(加载器部分)
- Modify: `server/tests/wordbook_helpers.py`(`MINI_DEFS`、`make_defs_dir`)

**Interfaces:**
- Produces(`app.wordbook.definitions`):`FILE_NAME = "definitions.jsonl"`、`DIR_NAME = "wordbook-definitions"`、`MAX_PER_POS = 2`、`MAX_TOTAL = 4`、`default_path(book_data_dir) -> Path`、`select_defs(defs, max_per_pos=2, max_total=4)`、`class Definitions(path)`:`defs_for(key) -> list[{"pos","text"}]`、`async warm()`、`reload()`、`__len__`。
- Produces(`tests/wordbook_helpers.py`):`MINI_DEFS`(迷你词书每个词一两条释义)、`make_defs_dir(tmp_path, rows=None) -> Path`(写 `<tmp>/wordbook-definitions/definitions.jsonl`,与 `make_data_dir` 的 `<tmp>/dict` 同级)。

- [ ] **Step 1: 测试夹具** — 对 `server/tests/wordbook_helpers.py` 应用:

````diff
--- a/server/tests/wordbook_helpers.py
+++ b/server/tests/wordbook_helpers.py
@@ -1,4 +1,5 @@
 """背单词测试夹具:迷你词书目录与开关注入(计划 P-W1)。"""
+import json
 import shutil
 from pathlib import Path
 
@@ -13,6 +14,34 @@
     return data
 
 
+MINI_DEFS = {  # English definitions for the mini fixture book (spec 2026-10-12-wordbook-definitions)
+    "talk": [("v", "speak to someone"), ("v", "have a conversation"), ("n", "a conversation between people")],
+    "ability": [("n", "the power or skill to do something")],
+    "able": [("a", "having the power or skill to do something")],
+    "abandon": [("v", "leave something or someone for good")],
+    "absorb": [("v", "take in a liquid or gas slowly")],
+    "accept": [("v", "agree to take something offered")],
+    "accident": [("n", "something bad that happens by chance")],
+    "go": [("v", "move or travel to a place")],
+    "child": [("n", "a young person who is not yet an adult")],
+    "careful": [("a", "thinking about what you do to avoid mistakes")],
+    "carry": [("v", "hold something and take it somewhere")],
+    "stop": [("v", "end a movement or an action")],
+    "used to": [("v", "did something often in the past")],
+    "monday": [("n", "the day of the week after Sunday")],
+}
+
+
+def make_defs_dir(tmp_path: Path, rows: dict | None = None) -> Path:
+    """`<tmp>/wordbook-definitions/definitions.jsonl`: the sibling of `make_data_dir`'s `<tmp>/dict` (what the loader finds)."""
+    folder = tmp_path / "wordbook-definitions"
+    folder.mkdir(exist_ok=True)
+    lines = [json.dumps({"word": w, "defs": [{"pos": p, "text": t, "src": "oewn"} for p, t in defs]}, ensure_ascii=False)
+             for w, defs in sorted((MINI_DEFS if rows is None else rows).items())]
+    (folder / "definitions.jsonl").write_bytes(("\n".join(lines) + "\n").encode("utf-8"))
+    return folder
+
+
 def enable_wordbook(app, data_dir: Path, **overrides) -> None:
     app.state.settings = app.state.settings.model_copy(
         update={"wordbook_enabled": True, "wordbook_data_dir": str(data_dir), "wordbook_spot_check_pct": 0, **overrides})
````

- [ ] **Step 2: 写失败测试** — 创建 `server/tests/test_wordbook_definitions.py`(R2 会在末尾追加端点测试):

````python
"""English definitions at runtime (spec 2026-10-12-wordbook-definitions §3-§4): loader, selection, `defs_en` on every card."""
import asyncio
import logging
import threading
from pathlib import Path

import pytest

from app.wordbook.definitions import FILE_NAME, Definitions, default_path, select_defs
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/wordbook"


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))
    return path


# ---- select_defs: <= 2 per POS, <= 4 in total, first of every POS before any second ----

def test_select_keeps_everything_under_the_limits():
    defs = [("n", "a"), ("n", "b"), ("v", "c")]
    assert select_defs(defs) == defs


def test_select_caps_two_per_pos():
    defs = [("n", "a"), ("n", "b"), ("n", "c")]
    assert select_defs(defs) == [("n", "a"), ("n", "b")]


def test_select_caps_four_in_total_and_gives_each_pos_its_first_entry_first():
    defs = [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1"), ("a", "a2"), ("r", "r1")]
    # firsts n1 v1 a1 r1 fill all four places; no second entry gets in, order stays the file order
    assert select_defs(defs) == [("n", "n1"), ("v", "v1"), ("a", "a1"), ("r", "r1")]


def test_select_uses_left_over_places_for_second_entries_in_file_order():
    defs = [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1")]
    assert select_defs(defs) == [("n", "n1"), ("n", "n2"), ("v", "v1"), ("a", "a1")]


# ---- Definitions loader ----

def test_default_path_is_a_sibling_of_the_book_directory(tmp_path):
    assert default_path(tmp_path / "dictionaries" / "kylebing-english-vocabulary") == (
        tmp_path / "dictionaries" / "wordbook-definitions" / FILE_NAME)


def test_loader_reads_lowercase_keys_and_returns_wire_shape(tmp_path):
    path = write(tmp_path / FILE_NAME,
                 '{"word":"talk","defs":[{"pos":"v","text":"speak","src":"oewn"},{"pos":"n","text":"a chat","src":"oewn"}]}\n')
    d = Definitions(path)
    assert d.defs_for("talk") == [{"pos": "v", "text": "speak"}, {"pos": "n", "text": "a chat"}]
    assert d.defs_for("Talk") == [] and d.defs_for("zebra") == []
    assert len(d) == 1


def test_missing_file_means_no_definitions_and_no_error(tmp_path):
    d = Definitions(tmp_path / "nope" / FILE_NAME)
    assert d.defs_for("talk") == [] and len(d) == 0


def test_bad_lines_are_skipped_not_fatal(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="app")
    good = '{"word":"talk","defs":[{"pos":"v","text":"speak","src":"oewn"}]}'
    path = write(tmp_path / FILE_NAME, "\n".join([
        "not json", '{"word":"x"}', '{"word":"y","defs":[]}', '{"word":"z","defs":[{"pos":"zz","text":"t"}]}',
        '{"word":"w","defs":[{"pos":"n","text":"  "}]}', good]) + "\n")
    d = Definitions(path)
    assert d.defs_for("talk") == [{"pos": "v", "text": "speak"}]
    assert all(d.defs_for(w) == [] for w in "xyzw")
    assert "skipped lines=5" in caplog.text
    assert "talk" not in caplog.text  # words never reach the log


def test_reload_picks_up_a_changed_file(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"a1","defs":[{"pos":"n","text":"one"}]}\n')
    d = Definitions(path)
    assert d.defs_for("a1")
    write(path, '{"word":"b1","defs":[{"pos":"n","text":"two"}]}\n')
    assert d.defs_for("b1") == []  # cached until reload
    d.reload()
    assert d.defs_for("b1") and not d.defs_for("a1")


def test_concurrent_first_use_loads_once(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"talk","defs":[{"pos":"v","text":"speak"}]}\n')
    d = Definitions(path)
    loads = []
    real = d._load

    def counting():
        loads.append(1)
        return real()

    d._load = counting
    threads = [threading.Thread(target=lambda: d.defs_for("talk")) for _ in range(8)]
    [t.start() for t in threads]
    [t.join(5) for t in threads]
    assert len(loads) == 1


async def test_warm_loads_off_the_loop_once(tmp_path):
    path = write(tmp_path / FILE_NAME, '{"word":"talk","defs":[{"pos":"v","text":"speak"}]}\n')
    d = Definitions(path)
    await asyncio.gather(d.warm(), d.warm())
    assert d._data is not None and d.defs_for("talk")


def test_the_loader_module_is_stdlib_only():
    source = (Path(__file__).resolve().parents[1] / "app" / "wordbook" / "definitions.py").read_text(encoding="utf-8")
    imports = {line.split()[1].split(".")[0] for line in source.splitlines() if line.startswith(("import ", "from "))}
    assert imports <= {"asyncio", "json", "logging", "threading", "pathlib"}  # no httpx, no app.providers: nothing can call out
````

- [ ] **Step 3: 运行确认失败** — `cd server && uv run pytest -q tests/test_wordbook_definitions.py` → `ModuleNotFoundError: app.wordbook.definitions`。

- [ ] **Step 4: 实现** — 创建 `server/app/wordbook/definitions.py`:

````python
"""英文释义(设计文档 2026-10-12-wordbook-definitions §3、§4):运行时只读 definitions.jsonl,键对键查询。

文件缺失或损坏 = 没有英文释义,其余功能照常(静默降级);不发任何网络请求,不调用任何 LLM,不记录词。
文件由 `server/scripts/wordbook_definitions.py` 离线生成,这里不假设它一定存在、不写它。纯标准库。"""
import asyncio
import json
import logging
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

FILE_NAME = "definitions.jsonl"
DIR_NAME = "wordbook-definitions"
MAX_PER_POS = 2
MAX_TOTAL = 4
POS_VALUES = frozenset({"n", "v", "a", "r", "prep", "pron", "conj", "art", "num", "aux", "int"})

Def = tuple[str, str]  # (pos, text)


def default_path(book_data_dir: Path) -> Path:
    """释义目录与词书目录同级:`<dictionaries>/wordbook-definitions/definitions.jsonl`(容器里 /app/dictionaries/...)。"""
    return Path(book_data_dir).parent / DIR_NAME / FILE_NAME


def select_defs(defs: list[Def], max_per_pos: int = MAX_PER_POS, max_total: int = MAX_TOTAL) -> list[Def]:
    """每个词性最多 `max_per_pos` 条、总共最多 `max_total` 条;名额先给每个词性的第一条(按文件里的词性顺序),
    再给第二条;结果保持文件里的原顺序。"""
    per_pos: dict[str, int] = {}
    pool: list[int] = []
    for i, (pos, _) in enumerate(defs):
        if per_pos.get(pos, 0) < max_per_pos:
            per_pos[pos] = per_pos.get(pos, 0) + 1
            pool.append(i)
    firsts, seconds, seen = [], [], set()
    for i in pool:
        (seconds if defs[i][0] in seen else firsts).append(i)
        seen.add(defs[i][0])
    chosen = (firsts + seconds)[:max_total]
    return [defs[i] for i in sorted(chosen)]


def _parse(line: bytes) -> tuple[str, tuple[Def, ...]] | None:
    try:
        row = json.loads(line)
        word = row["word"]
        defs = tuple((d["pos"], d["text"]) for d in row["defs"])
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(word, str) or not word or not defs:
        return None
    if any(pos not in POS_VALUES or not isinstance(text, str) or not text.strip() for pos, text in defs):
        return None
    return word, defs


class Definitions:
    """懒加载的 word -> ((pos, text), ...)。第一次查询(或 `warm`)读一次文件;线程安全;`reload` 丢弃缓存。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, tuple[Def, ...]] | None = None

    def _load(self) -> dict[str, tuple[Def, ...]]:
        data: dict[str, tuple[Def, ...]] = {}
        bad = 0
        try:
            with self.path.open("rb") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    parsed = _parse(line)
                    if parsed is None:
                        bad += 1
                    else:
                        data[parsed[0]] = parsed[1]
        except OSError:
            logger.info("wordbook definitions file unavailable")
            return {}
        if bad:
            logger.warning("wordbook definitions skipped lines=%d", bad)
        return data

    def _ensure(self) -> dict[str, tuple[Def, ...]]:
        data = self._data
        if data is None:
            with self._lock:
                if self._data is None:
                    self._data = self._load()
                data = self._data
        return data

    async def warm(self) -> None:
        """在事件循环之外先读一次(几 MB),之后的 `defs_for` 不再阻塞。"""
        if self._data is None:
            await asyncio.to_thread(self._ensure)

    def reload(self) -> None:
        with self._lock:
            self._data = None

    def __len__(self) -> int:
        return len(self._ensure())

    def defs_for(self, key: str) -> list[dict]:
        """`[{"pos": "n", "text": "..."}]`,每词性最多 2 条、总共最多 4 条;没有 = 空列表。键是规范化小写词。"""
        found = self._ensure().get(key)
        if not found:
            return []
        return [{"pos": pos, "text": text} for pos, text in select_defs(list(found))]
````

- [ ] **Step 5: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_definitions.py tests/test_architecture.py` → 全绿(12 个)。

- [ ] **Step 6: 提交**

```
git add server/app/wordbook/definitions.py server/tests/test_wordbook_definitions.py server/tests/wordbook_helpers.py
git commit -m "feat(server): lazy, stdlib-only loader for wordbook English definitions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task R2: 每个构造卡片的地方都带 `defs_en`

**Files:**
- Modify: `server/app/wordbook/index.py`、`server/app/wordbook/service.py`、`server/app/links/word_actions.py`
- Modify: `server/tests/test_wordbook_definitions.py`(追加端点测试)

**Interfaces:**
- Consumes:R1 的 `Definitions`。
- Produces:`DictionaryStore.definitions`;`service.card_out(card, ds)`(第二个参数必填,漏改的调用点会立刻 `TypeError`);卡片对象在 `defs_en` 非空时多一个键:`[{"pos": "n", "text": "..."}]`(每词性 ≤ 2、总共 ≤ 4)。
- 构造卡片的全部地方(读代码确认,共 6 处,都经 `card_out`):`learn_batch.cards`、`review_batch.cards`、`spell_submit.words[].card`、`card_detail`(`GET /cards/{book}/{key}` 和 `learned/card`)、`free_start.items[].card`、`links` 的 `POST /api/links/wordbook/card`。`learned/query` 的列表项不含卡片对象,不变(spec §5:已学词列表不变)。

- [ ] **Step 1: 写失败测试** — 在 `server/tests/test_wordbook_definitions.py` 末尾追加:

````python
# ---- every endpoint that builds a card ----

async def login(app, client, tmp_path, *, defs=True, books=("junior",)):
    enable_wordbook(app, make_data_dir(tmp_path, books), wordbook_books=",".join(books))
    if defs:
        make_defs_dir(tmp_path)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": books[0], "order_mode": "book"})
    return h


async def test_learn_batch_cards_carry_defs_en_and_keep_every_old_key(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    cards = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})).json()["cards"]
    assert cards and all({"key", "word", "us", "uk", "senses", "phrases", "examples"} <= set(c) for c in cards)
    talk = next(c for c in cards if c["key"] == "talk")
    assert talk["defs_en"] == [{"pos": "v", "text": "speak to someone"}, {"pos": "v", "text": "have a conversation"},
                               {"pos": "n", "text": "a conversation between people"}]


async def test_no_definitions_file_means_no_defs_en_key(app, client, tmp_path):
    h = await login(app, client, tmp_path, defs=False)
    cards = (await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})).json()["cards"]
    assert cards and all("defs_en" not in c for c in cards)
    assert "defs_en" not in (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()


async def test_a_word_without_a_definition_has_no_key(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path, {"ability": [("n", "skill")]})
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get(f"{URL}/cards/junior/ability", headers=h)).json()["defs_en"] == [{"pos": "n", "text": "skill"}]
    assert "defs_en" not in (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()


async def test_card_detail_review_learned_card_and_free_start_carry_it(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["defs_en"][0]["text"] == "speak to someone"
    await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                         "qtype": "meaning", "known": True})
    learned = await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert learned.json()["defs_en"][0]["pos"] == "v"
    free = await client.post(f"{URL}/free/start", headers=h, json={"scope": "all", "mode": "browse", "count": 10})
    assert [i["card"]["defs_en"][0]["pos"] for i in free.json()["items"]] == ["v"]


async def test_more_than_four_defs_in_the_file_are_cut_at_four(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    make_defs_dir(tmp_path, {"talk": [("n", "n1"), ("n", "n2"), ("v", "v1"), ("v", "v2"), ("a", "a1"), ("r", "r1")]})
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    got = (await client.get(f"{URL}/cards/junior/talk", headers=h)).json()["defs_en"]
    assert [(d["pos"], d["text"]) for d in got] == [("n", "n1"), ("v", "v1"), ("a", "a1"), ("r", "r1")]


async def test_links_word_card_carries_it_too(app, client, tmp_path):
    from tests.links_helpers import enable_links
    h = await login(app, client, tmp_path)
    enable_links(app)
    r = await client.post("/api/links/wordbook/card", headers=h, json={"word": "talk"})
    assert r.status_code == 200 and r.json()["card"]["defs_en"][0]["text"] == "speak to someone"


async def test_reading_definitions_logs_no_words_and_calls_nothing_out(app, client, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await login(app, client, tmp_path)
    await client.post(f"{URL}/learn/batch", headers=h, json={"size": 3})
    await client.get(f"{URL}/cards/junior/talk", headers=h)
    assert "speak to someone" not in caplog.text and "talk" not in caplog.text
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_wordbook_definitions.py` → 新测试失败(`KeyError: 'defs_en'`)。

- [ ] **Step 3: 实现** — 对三个文件应用下列修改(unified diff;用 Edit 工具逐处改):

`server/app/wordbook/index.py`:

````diff
--- a/server/app/wordbook/index.py
+++ b/server/app/wordbook/index.py
@@ -12,6 +12,7 @@
 from pathlib import Path
 
 from app.wordbook.books import book_by_id
+from app.wordbook.definitions import Definitions, default_path
 from app.wordbook.entry import WordCard, clean_sentence, headword_key, merge_rows, pos_mask_of, pos_parts
 from app.wordbook.textnorm import find_form
 
@@ -103,6 +104,7 @@
 class DictionaryStore:
     def __init__(self, data_dir: Path, *, cache_size: int = 1024):
         self.data_dir = Path(data_dir)
+        self.definitions = Definitions(default_path(self.data_dir))  # English definitions (spec 2026-10-12 §3)
         self._cache_size = cache_size
         self._indexes: dict[str, BookIndex] = {}
         self._locks: dict[str, asyncio.Lock] = {}
@@ -185,6 +187,7 @@
 
     def reload(self, book_id: str | None = None) -> None:
         self._generation += 1
+        self.definitions.reload()
         if book_id is None:
             self._indexes.clear()
             self._cards.clear()
````

`server/app/wordbook/service.py`(`ensure_hidden`、`card_out`、五处调用点):

````diff
--- a/server/app/wordbook/service.py
+++ b/server/app/wordbook/service.py
@@ -105,6 +105,7 @@
     """进程里第一次用到例句前,从 wordbook_hidden_sentences 载入屏蔽集合(管理端屏蔽时会刷新)。"""
     if not ds.hidden_loaded:
         await store.load_hidden(session, ds)
+    await ds.definitions.warm()  # English definitions: read the file off the event loop once per process
 
 
 def book_out(b: BookSpec, **extra) -> dict:
@@ -125,11 +126,15 @@
     }
 
 
-def card_out(card: WordCard) -> dict:
-    return {"key": card.key, "word": card.word, "us": card.us, "uk": card.uk,
-            "senses": [{"pos": s.pos, "text": s.text} for s in card.senses],
-            "phrases": [{"en": en, "zh": zh} for en, zh in card.phrases],
-            "examples": [{"id": e.id, "en": e.en, "zh": e.zh} for e in card.examples]}
+def card_out(card: WordCard, ds: DictionaryStore) -> dict:
+    """The one place a card object is built. `defs_en` (spec 2026-10-12 §4) is additive: absent = no English definition."""
+    out = {"key": card.key, "word": card.word, "us": card.us, "uk": card.uk,
+           "senses": [{"pos": s.pos, "text": s.text} for s in card.senses],
+           "phrases": [{"en": en, "zh": zh} for en, zh in card.phrases],
+           "examples": [{"id": e.id, "en": e.en, "zh": e.zh} for e in card.examples]}
+    if defs := ds.definitions.defs_for(card.key):
+        out["defs_en"] = defs
+    return out
 
 
 def item_out(known: Known | None) -> dict | None:
@@ -281,7 +286,7 @@
     quiz = [question_out(await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0))) for c in cards]
     # spec recall §3.3:「不认识」的词在本轮小测里第二次出现时用看释义选词(随机源与 quiz 不同)
     drill = [question_out(await _question(ds, index, c, "word", question_rng(user_id, c.key, 1))) for c in cards]
-    return {"book_id": e.book_id, "cards": [card_out(c) for c in cards], "quiz": quiz, "drill": drill}
+    return {"book_id": e.book_id, "cards": [card_out(c, ds) for c in cards], "quiz": quiz, "drill": drill}
 
 
 async def review_batch(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
@@ -302,7 +307,7 @@
         qtype = "recall" if recall_on and use_recall(user_id, card.key, row.reps, row.box) else pick_qtype(
             row.box, card, rng, tts=tts)
         questions.append(question_out(await _question(ds, index, card, qtype, rng)))
-    return {"book_id": e.book_id, "questions": questions, "cards": [card_out(c) for c in cards]}
+    return {"book_id": e.book_id, "questions": questions, "cards": [card_out(c, ds) for c in cards]}
 
 
 async def _write_srs(session: AsyncSession, user_id: int, row: Known, grade: str, now) -> tuple[bool, bool]:
@@ -692,7 +697,7 @@
             blanks.append({"i": next_blank, "outcome": r.outcome, "credit": r.credit, "typed": r.typed,
                            "expected": r.expected, "diff": [asdict(d) for d in r.diff]})
             next_blank += 1
-        words.append({"key": card.key, "outcome": outcome, "credit": credit, "blanks": blanks, "card": card_out(card)})
+        words.append({"key": card.key, "outcome": outcome, "credit": credit, "blanks": blanks, "card": card_out(card, ds)})
     set_credit = round(sum(w["credit"] for w in words) / len(words))
     # 同一组(服务端按 (key, sentence_id) 重算的 set_id,不用客户端传的)每个本地日只计一次:「再练一遍」不再得分
     set_id = set_id_for([cloze for _, cloze, _ in graded])
@@ -715,7 +720,7 @@
     card = (await cards_or_fail(ds, book_id, [key])).get(key)
     if card is None:
         fail(WORD_NOT_FOUND)
-    return card_out(card)
+    return card_out(card, ds)
 
 
 async def find_card(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, key: str) -> WordCard:
@@ -985,7 +990,7 @@
         if mode != "browse":
             qtype = "recall" if mode == "recall" else "spell" if mode == "spell" else free_choice_qtype(card, qrng)
             question = question_out(await _question(ds, await index_or_fail(ds, book_id), card, qtype, qrng))
-        items.append({"book_id": book_id, "card": card_out(card), "question": question})
+        items.append({"book_id": book_id, "card": card_out(card, ds), "question": question})
         if len(items) == count:
             break
     if not items:
````

`server/app/links/word_actions.py`:

````diff
--- a/server/app/links/word_actions.py
+++ b/server/app/links/word_actions.py
@@ -79,7 +79,7 @@
             continue
         if found is not None:
             item = await store.known_one(session, user.id, found.key)
-            return {"book_id": book_id, "card": service.card_out(found), "item": service.item_out(item)}
+            return {"book_id": book_id, "card": service.card_out(found, ds), "item": service.item_out(item)}
     if books and unavailable == len(books):  # Ruling(L1-1):所有启用的书都读不到 → 503,而不是假装「没有这个词」
         raise HTTPException(503, UNAVAILABLE)
     raise HTTPException(404, NOT_FOUND)
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_definitions.py tests/test_wordbook_api.py tests/test_wordbook_learned_api.py tests/test_wordbook_free_start.py tests/test_wordbook_spell.py tests/test_links_word_actions.py tests/test_admin_wordbook.py tests/test_architecture.py` → 全绿(不带释义文件的旧测试里卡片没有 `defs_en` 键,所以原有断言不变)。注意此时 `tests/test_wordbook_contract.py` 仍通过(它的迷你词书没有释义文件);P1 才改它。

- [ ] **Step 5: 提交**

```
git add server/app/wordbook/index.py server/app/wordbook/service.py server/app/links/word_actions.py server/tests/test_wordbook_definitions.py
git commit -m "feat(server): add optional defs_en to every wordbook card object" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task P1: 用户偏好 `def_lang` 与契约夹具重录

**Files:**
- Modify: `server/app/wordbook/store.py`、`server/app/wordbook/service.py`、`server/app/routers/wordbook.py`
- Create: `server/tests/test_wordbook_def_lang.py`
- Modify: `server/tests/test_wordbook_contract.py`、`server/tests/fixtures/wordbook_contract.json`(生成)

**Interfaces:**
- Produces(`store`):`DEF_LANGS = ("both", "zh", "en")`、`DEFAULT_DEF_LANG = "both"`、`DEF_PREF_KIND = "defpref"`、`get_def_lang(session, user_id) -> str`(取最新一行,无行或值非法 → `both`)、`set_def_lang(session, user_id, value, day, now)`(追加一行并 flush,不提交)。
- Produces(`service`):`INVALID_DEF_LANG = (422, "Invalid definition language")`、`config_out(settings, def_lang="both")`(多一个顶层键 `def_lang`)、`def_lang_of(session, user_id)`、`patch_enrollment(..., def_lang=None)`(语义见 R-DS4)。
- Produces(HTTP):`GET /api/wordbook/config` → 多 `"def_lang"`(开关关闭时仍是 `{"enabled": false}`);`PATCH /api/wordbook/enrollment` 体多可选 `def_lang`。
- Produces(契约):夹具里 `config.def_lang`、新键 `def_lang_patch`、所有返回卡片的位置首张都带 `defs_en`;网页契约测试(W 计划)读它。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_wordbook_def_lang.py`:

````python
"""`def_lang` preference (spec 2026-10-12-wordbook-definitions §4, plan R-DS3): stored per user, no migration."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import WordbookEvent
from app.wordbook import store
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def register(app, client, tmp_path, name="alice", **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def config(client, h) -> dict:
    return (await client.get(f"{URL}/config", headers=h)).json()


async def pref_rows(app) -> list[tuple[int, str, str]]:
    async with app.state.sessionmaker() as s:
        rows = await s.execute(select(WordbookEvent.user_id, WordbookEvent.book_id, WordbookEvent.outcome)
                               .where(WordbookEvent.kind == store.DEF_PREF_KIND).order_by(WordbookEvent.id))
        return [tuple(r) for r in rows]


async def test_default_is_both_and_the_key_sits_next_to_the_other_config_keys(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    cfg = await config(client, h)
    assert cfg["def_lang"] == "both" and {"enabled", "defaults", "learn", "limits", "books"} <= set(cfg)


async def test_disabled_config_is_unchanged(app, client, tmp_path):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get(f"{URL}/config", headers=h)).json() == {"enabled": False}


@pytest.mark.parametrize("value", ["zh", "en", "both"])
async def test_patch_saves_and_config_returns_it(app, client, tmp_path, value):
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en" if value == "both" else "both"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": value})
    assert r.status_code == 200 and r.json() == {"def_lang": value}  # no active book: only the preference comes back
    assert (await config(client, h))["def_lang"] == value


@pytest.mark.parametrize("bad", ["fr", "", "EN", 1, None, ["en"], {"x": 1}])
async def test_unknown_values_are_422_and_change_nothing(app, client, tmp_path, bad):
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": bad})
    assert r.status_code == 422  # None alone is "No changes", also 422
    assert (await config(client, h))["def_lang"] == "zh"


async def test_extra_keys_are_still_rejected(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en", "foo": 1})).status_code == 422


async def test_it_is_per_user(app, client, tmp_path):
    a = await register(app, client, tmp_path)
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    b = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.patch(f"{URL}/enrollment", headers=a, json={"def_lang": "en"})
    assert (await config(client, a))["def_lang"] == "en" and (await config(client, b))["def_lang"] == "both"


async def test_with_an_active_book_the_response_is_the_enrollment_plus_def_lang(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    assert r.status_code == 200
    body = r.json()
    assert body["def_lang"] == "en" and body["book_id"] == "junior" and "daily_new" in body


async def test_goals_and_def_lang_in_one_request_cost_one_settings_use(app, client, tmp_path, monkeypatch):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 2)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 7, "def_lang": "zh"})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 8})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 9})).status_code == 429
    assert (await config(client, h))["def_lang"] == "zh"


async def test_an_invalid_goal_with_a_def_lang_changes_neither(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 5, "def_lang": "en"})
    assert r.status_code == 200
    app.state.settings = app.state.settings.model_copy(update={"wordbook_daily_new_max": 10})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 50, "def_lang": "zh"})
    assert r.status_code == 422
    assert (await config(client, h))["def_lang"] == "en"


async def test_an_unchanged_value_writes_nothing_and_costs_nothing(app, client, tmp_path, monkeypatch):
    h = await register(app, client, tmp_path)
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 1)
    for _ in range(3):
        assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "both"})).status_code == 200
    assert await pref_rows(app) == []
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"})).status_code == 429
    assert [r[2] for r in await pref_rows(app)] == ["en"]


async def test_change_history_is_events_with_an_empty_book_id_and_the_latest_wins(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    for value in ("en", "zh", "en"):
        await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": value})
    rows = await pref_rows(app)
    assert [(r[1], r[2]) for r in rows] == [("", "en"), ("", "zh"), ("", "en")]
    assert (await config(client, h))["def_lang"] == "en"


async def test_the_preference_rows_do_not_touch_plans_rank_or_the_admin_book_counts(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    plan = (await client.get(f"{URL}/today", headers=h)).json()["plan"]
    assert plan["new_done"] == 0 and plan["review_done"] == 0 and plan["goal_met"] is False
    async with app.state.sessionmaker() as s:
        by_book = (await s.execute(select(WordbookEvent.book_id, func.count()).group_by(WordbookEvent.book_id))).all()
    assert [tuple(r) for r in by_book] == [("", 1)]  # nothing is attributed to "junior"


async def test_no_user_content_in_logs(app, client, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    await config(client, h)
    assert "def_lang" not in caplog.text and "alice" not in caplog.text


async def test_patching_requires_the_wordbook_switch_and_a_login(app, client, tmp_path):
    h = await register(app, client, tmp_path, wordbook_enabled=False)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})).status_code == 404
    assert (await client.patch(f"{URL}/enrollment", json={"def_lang": "en"})).status_code == 401
````

- [ ] **Step 2: 运行确认失败** — `cd server && uv run pytest -q tests/test_wordbook_def_lang.py` → 失败(`KeyError: 'def_lang'`、`AttributeError: ... DEF_PREF_KIND`)。

- [ ] **Step 3: 实现** — 应用下列修改:

`server/app/wordbook/store.py`(接在 `consume_settings` 之后):

````diff
--- a/server/app/wordbook/store.py
+++ b/server/app/wordbook/store.py
@@ -284,6 +284,30 @@
     return await usage.consume(session, "wordbook_settings", str(user_id), day, SETTINGS_DAILY_MAX)
 
 
+# ---- 释义显示偏好 def_lang(spec 2026-10-12-wordbook-definitions §4;计划 R-DS3:无迁移)----
+# wordbook 没有「每用户设置」的表或 JSON 列,所以偏好存成 wordbook_events 里的一行 kind="defpref"(book_id 为空串,
+# outcome = 值),取最新一行;段位只读 learn/spell_set,计划只数 learn/relearn/review,管理端按书统计的查询按 book_id 过滤,
+# 都读不到它。每次改动占用「设置」每日 60 次里的一次,所以行数有上限。
+
+DEF_LANGS = ("both", "zh", "en")
+DEFAULT_DEF_LANG = "both"
+DEF_PREF_KIND = "defpref"
+
+
+async def get_def_lang(session: AsyncSession, user_id: int) -> str:
+    value = await session.scalar(select(WordbookEvent.outcome).where(
+        WordbookEvent.book_id == "", WordbookEvent.kind == DEF_PREF_KIND, WordbookEvent.user_id == user_id)
+        .order_by(WordbookEvent.id.desc()).limit(1))
+    return value if value in DEF_LANGS else DEFAULT_DEF_LANG
+
+
+async def set_def_lang(session: AsyncSession, user_id: int, value: str, day: str, now: datetime) -> None:
+    """追加一行偏好事件;flush 不提交。"""
+    await add_event(session, user_id=user_id, book_id="", kind=DEF_PREF_KIND, word=DEF_PREF_KIND, item_id=None,
+                    qtype=None, outcome=value, credit=0, day=day, now=now)
+    await session.flush()
+
+
 async def pause_active(session: AsyncSession, user_id: int, now: datetime) -> WordbookEnrollment | None:
     """把当前在学的书设为 paused 并提交;没有在学的书返回 None。"""
     e = await active_enrollment(session, user_id)
````

`server/app/wordbook/service.py`:

````diff
--- a/server/app/wordbook/service.py
+++ b/server/app/wordbook/service.py
@@ -58,6 +58,7 @@
 INVALID_CURSOR = (422, "Invalid cursor")
 INVALID_DATE = (422, "Invalid date")
 INVALID_SCOPE = (422, "Invalid scope")
+INVALID_DEF_LANG = (422, "Invalid definition language")
 NOTHING_TO_REVIEW = (409, "No words to review")
 FREE_LIMIT = (429, "Daily free-review limit reached")
 STREAK_LOOKBACK_DAYS = 400
@@ -112,7 +113,7 @@
     return {"id": b.id, "title_zh": b.title_zh, "title_en": b.title_en, "level": b.level, "words": b.unique, **extra}
 
 
-def config_out(settings: Settings) -> dict:
+def config_out(settings: Settings, def_lang: str = store.DEFAULT_DEF_LANG) -> dict:
     """GET /api/wordbook/config(开关打开时)。available = 数据文件存在(校验和由管理端「诊断」检查)。"""
     data_dir = settings.resolved_wordbook_data_dir
     enabled = enabled_books(settings.wordbook_books)
@@ -122,10 +123,15 @@
         "defaults": {"daily_new": settings.wordbook_daily_new, "review_cap": settings.wordbook_review_cap},
         "learn": {"autoplay": settings.wordbook_autoplay, "show_example": settings.wordbook_show_example},  # recall §7
         "limits": limits_out(limits_of(settings)),  # goals §9
+        "def_lang": def_lang,  # 释义显示偏好 both | zh | en(spec 2026-10-12-wordbook-definitions §4)
         "books": [book_out(b, available=(data_dir / b.file).is_file()) for b in BOOKS if b.id in enabled],
     }
 
 
+async def def_lang_of(session: AsyncSession, user_id: int) -> str:
+    return await store.get_def_lang(session, user_id)
+
+
 def card_out(card: WordCard, ds: DictionaryStore) -> dict:
     """The one place a card object is built. `defs_en` (spec 2026-10-12 §4) is additive: absent = no English definition."""
     out = {"key": card.key, "word": card.word, "us": card.us, "uk": card.uk,
@@ -765,22 +771,36 @@
 # ---- 每日目标(goals v2,spec 2026-10-11 §3、§9)----
 
 async def patch_enrollment(session: AsyncSession, user_id: int, settings: Settings, *, daily_new: int | None,
-                           review_cap: int | None, review_unlimited: bool, order_mode: str | None, now) -> dict:
-    """改当前在学的书的每日设置,立即生效(今天的计数来自事件,不受影响)。先校验后扣次数。"""
-    if daily_new is None and review_cap is None and not review_unlimited and order_mode is None:
+                           review_cap: int | None, review_unlimited: bool, order_mode: str | None, now,
+                           def_lang: str | None = None) -> dict:
+    """改当前在学的书的每日设置,立即生效(今天的计数来自事件,不受影响)。先校验后扣次数。
+    `def_lang`(释义显示偏好,按用户、不按书)可以单独传:这时不需要有在学的书;传了就在响应里带回 `def_lang`。
+    值没变 = 不写、不扣次数。"""
+    goals = not (daily_new is None and review_cap is None and not review_unlimited and order_mode is None)
+    if not goals and def_lang is None:
         fail(NO_CHANGES)
+    if def_lang is not None and def_lang not in store.DEF_LANGS:
+        fail(INVALID_DEF_LANG)
     e = await store.active_enrollment(session, user_id)
-    if e is None:
-        fail(NO_ACTIVE)
-    book_or_fail(settings, e.book_id)
     limits = limits_of(settings)
-    if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
-        raise WordbookError(422, error)
-    if not await store.consume_settings(session, user_id, utc_day(now)):
+    if goals:
+        if e is None:
+            fail(NO_ACTIVE)
+        book_or_fail(settings, e.book_id)
+        if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
+            raise WordbookError(422, error)
+    change_lang = def_lang is not None and def_lang != await store.get_def_lang(session, user_id)
+    if (goals or change_lang) and not await store.consume_settings(session, user_id, utc_day(now)):
         fail(SETTINGS_LIMIT)
-    cap = planning.REVIEW_UNLIMITED if review_unlimited else review_cap
-    e = await store.update_goals(session, e, daily_new=daily_new, review_cap=cap, order_mode=order_mode, now=now)
-    return enrollment_out(e, limits)
+    if change_lang:
+        await store.set_def_lang(session, user_id, def_lang, utc_day(now), now)
+    if goals:
+        cap = planning.REVIEW_UNLIMITED if review_unlimited else review_cap
+        e = await store.update_goals(session, e, daily_new=daily_new, review_cap=cap, order_mode=order_mode, now=now)
+    elif change_lang:
+        await session.commit()
+    out = enrollment_out(e, limits) if e is not None else {}
+    return {**out, "def_lang": def_lang} if def_lang is not None else out
 
 
 BONUS_STEP_MAX = 20  # 每次最多加练 20 个(路由也校验)
````

`server/app/routers/wordbook.py`:

````diff
--- a/server/app/routers/wordbook.py
+++ b/server/app/routers/wordbook.py
@@ -49,8 +49,11 @@
 
 
 @router.get("/config")
-async def wordbook_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
-    return service.config_out(settings) if settings.wordbook_enabled else {"enabled": False}
+async def wordbook_config(user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
+                          settings: Settings = Depends(get_settings)):
+    if not settings.wordbook_enabled:
+        return {"enabled": False}
+    return service.config_out(settings, await service.def_lang_of(session, user.id))
 
 
 @router.get("/books")
@@ -259,6 +262,7 @@
     review_cap: int | None = Field(None, ge=REVIEW_MIN, le=REVIEW_MAX)
     review_unlimited: Literal[True] | None = None
     order_mode: Literal["shuffle", "book"] | None = None
+    def_lang: Literal["both", "zh", "en"] | None = None  # 释义显示偏好(按用户);未知值 → 422
 
 
 @router.patch("/enrollment")
@@ -269,7 +273,8 @@
         return await service.patch_enrollment(session, user.id, settings, daily_new=payload.daily_new,
                                               review_cap=payload.review_cap,
                                               review_unlimited=bool(payload.review_unlimited),
-                                              order_mode=payload.order_mode, now=utcnow())
+                                              order_mode=payload.order_mode, now=utcnow(),
+                                              def_lang=payload.def_lang)
     except service.WordbookError as e:
         _raise(e)
 
````

- [ ] **Step 4: 运行通过** — `cd server && uv run pytest -q tests/test_wordbook_def_lang.py tests/test_wordbook_goals_api.py tests/test_wordbook_goals_settings.py tests/test_wordbook_api.py tests/test_rank_wordbook.py tests/test_admin_wordbook.py tests/test_architecture.py` → 全绿(22 个新测试;原有的 `PATCH /enrollment` 测试不变,因为体里没有 `def_lang` 时响应逐字相同)。此时只有 `tests/test_wordbook_contract.py` 会失败(`config` 多了 `def_lang` 键,形状变了)——下一步重录它,**同一个提交**一起交。

- [ ] **Step 5: 改契约测试** — 对 `server/tests/test_wordbook_contract.py` 应用:

````diff
--- a/server/tests/test_wordbook_contract.py
+++ b/server/tests/test_wordbook_contract.py
@@ -13,18 +13,20 @@
 from app.models import VocabularyItem, utcnow
 from app.wordbook import service
 from tests.test_web_contract import shape
-from tests.wordbook_helpers import enable_wordbook, make_data_dir
+from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir
 
 FIXTURE = Path(__file__).parent / "fixtures" / "wordbook_contract.json"
 URL = "/api/wordbook"
 KEYS = {"config", "books", "enrollment", "today", "learn_batch", "answer_choice", "answer_typed", "review_batch",
         "spell_sets", "spell_submit", "card", "explain_unavailable", "answer_recall", "answer_check"}
 GOALS_KEYS = {"enrollment_patch", "bonus", "pause", "today_paused", "resume", "reset"}  # 计划 2026-10-11 GS5
+DEFS_KEYS = {"def_lang_patch"}  # 计划 2026-10-12-wordbook-definitions-server P1
 LEARNED_KEYS = {"learned_summary", "learned_list", "learned_card", "free_start", "answer_free"}  # 计划 2026-10-12-wordbook-learned-review S6
 
 
 async def collect(app, client, tmp_path, monkeypatch) -> dict:
     enable_wordbook(app, make_data_dir(tmp_path), wordbook_books="junior")
+    make_defs_dir(tmp_path)  # 英文释义(spec 2026-10-12-wordbook-definitions):词卡带可选的 defs_en
     r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
     h = {"Authorization": f"Bearer {r.json()['access_token']}"}
     out = {"config": (await client.get(f"{URL}/config", headers=h)).json()}
@@ -41,6 +43,8 @@
     async with app.state.sessionmaker() as s:  # 只让 talk(盒 0)到期:题型只会是选择题
         await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                         .values(due_at=utcnow() - timedelta(hours=1)))
+        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "able")  # 刚学的词不能被自由答错拉到今天到期(R-L6)
+                        .values(created_at=utcnow() - timedelta(days=2)))
         await s.commit()
     out["today"] = (await client.get(f"{URL}/today", headers=h)).json()
     out["review_batch"] = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 3})).json()
@@ -93,6 +97,7 @@
         assert r.status_code == 200, r.text
         return r.json()
     out = {"enrollment_patch": await ok(await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 5}))}
+    out["def_lang_patch"] = await ok(await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"}))
     out["bonus"] = await ok(await client.post(f"{URL}/bonus", headers=h, json={"size": 5}))
     out["pause"] = await ok(await client.post(f"{URL}/enrollment/pause", headers=h, json={}))
     out["today_paused"] = await ok(await client.get(f"{URL}/today", headers=h))
@@ -106,7 +111,7 @@
     real = random.Random
     monkeypatch.setattr(random, "Random", lambda seed=0: real(seed))  # 句组抽词固定,样例稳定
     actual = await collect(app, client, tmp_path, monkeypatch)
-    assert set(actual) == KEYS | GOALS_KEYS | LEARNED_KEYS
+    assert set(actual) == KEYS | GOALS_KEYS | LEARNED_KEYS | DEFS_KEYS
     if os.environ.get("CONTRACT_UPDATE"):
         FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
                            newline="\n")
@@ -125,4 +130,10 @@
     assert expected["answer_check"]["outcome"] == "pending" and expected["answer_check"]["check"]["options"]
     assert expected["learned_list"]["next_cursor"] and expected["answer_free"]["applied"] is True
     assert expected["free_start"]["items"][0]["question"]["options"]
+    # 英文释义(计划 2026-10-12-wordbook-definitions-server P1):每个返回词卡的端点,首张卡都带 defs_en
+    assert expected["config"]["def_lang"] == "both" and expected["def_lang_patch"]["def_lang"] == "en"
+    for cards in (expected["learn_batch"]["cards"], expected["review_batch"]["cards"], [expected["card"]],
+                  [expected["learned_card"]], [i["card"] for i in expected["free_start"]["items"]],
+                  [w["card"] for w in expected["spell_submit"]["words"]]):
+        assert cards[0]["defs_en"] and set(cards[0]["defs_en"][0]) == {"pos", "text"}
     assert "by_book" in expected["learned_summary"] and isinstance(expected["learned_summary"]["by_book"], list)
````

三处改动:迷你词书配一份释义文件(`make_defs_dir`),让卡片带 `defs_en`;录制流程里加 `def_lang_patch`(`PATCH /enrollment {"def_lang":"en"}` 的响应);把 `able` 的 `created_at` 往前改两天,修好 HEAD 上已坏的 `answer_free.applied` 断言(R-DS6)。新增断言:`config.def_lang` 默认 `both`,六类返回卡片的位置首张卡都有 `defs_en`(`{pos, text}`)。

- [ ] **Step 6: 重录并验证** — 录制只做**一次**(再录会让夹具里的随机值——用户 id 派生的选项顺序、时间戳——全变,diff 很吵,R-DS6):

```
cd server
$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE
uv run pytest -q tests/test_wordbook_contract.py tests/test_links_word_actions.py tests/test_wordbook_definitions.py tests/test_wordbook_def_lang.py tests/test_architecture.py
```

只读模式再跑一次也应通过。`git status` 应只有本任务列出的文件;`tests/fixtures/links_word_actions_contract.json` **不变**(那个测试的迷你词书没有释义文件)。想理解 R-DS6:在改测试之前,`CONTRACT_UPDATE=1` 跑一次会失败在 `applied is True`(随后 `git checkout -- server/tests/fixtures/wordbook_contract.json` 还原)。

- [ ] **Step 7: 提交(一个提交:偏好 + 契约重录)**

```
git add server/app/wordbook/store.py server/app/wordbook/service.py server/app/routers/wordbook.py server/tests/test_wordbook_def_lang.py server/tests/test_wordbook_contract.py server/tests/fixtures/wordbook_contract.json
git commit -m "feat(server): per-user def_lang preference (config + PATCH /enrollment, no migration); re-record wordbook contract" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Lane D · 手写虚词表、许可与 NOTICE

### Task D1: `function-words.jsonl`、`LICENSE-*`、`NOTICE`、`.gitattributes`、目录 `CLAUDE.md`

**Files:**
- Create: `server/dictionaries/wordbook-definitions/function-words.jsonl`、`LICENSE-OEWN`、`LICENSE-ECDICT`、`CLAUDE.md`
- Modify: `NOTICE`、`.gitattributes`
- Modify: `server/tests/test_wordbook_definitions_build.py`(追加一个测试)

**Interfaces:**
- Produces:手写表(103 个词、116 条;`src: "hand"`;词性只用虚词词性;≤ 12 个词);两份许可文件;根 `NOTICE` 两条;`.gitattributes` 两行。

- [ ] **Step 1: 追加失败测试** — 在构建测试末尾追加:

````python
def test_the_committed_hand_file_is_valid_and_covers_the_common_function_words():
    hand = wd.read_extras(wd.DATA_DIR / "function-words.jsonl", "hand", strict=True)
    assert len(hand) >= 60
    assert {"the", "a", "in", "of", "and", "to", "it", "that", "for", "with", "on"} <= set(hand)
    assert all(pos in wd.CLOSED_POS for by_pos in hand.values() for pos in by_pos)
````

运行 `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py` → 新测试失败(文件不存在)。

- [ ] **Step 2: 生成手写表** — 把下面的脚本存成 `$env:TEMP\make_hand.py`(**不提交**),在仓库根运行 `uv run --project server python -I $env:TEMP\make_hand.py server\dictionaries\wordbook-definitions\function-words.jsonl`(目录会自动建)。表里的词性是书里给这些词的词性(来自 `missing.txt` 前几行),构建时若书里没有这个词性会报错:

````python
import json
import sys
from pathlib import Path

# Usage: python make_hand.py <output function-words.jsonl>  (a throw-away generator; the committed file is the output)
H = {
 "the": {"art": "used before a noun to show a particular thing or person"},
 "be": {"aux": "used with another verb to form tenses and the passive"},
 "and": {"conj": "used to join words or parts of a sentence"},
 "of": {"prep": "used to show belonging, contents, or a part of something"},
 "a": {"art": "used before a singular noun to mean one, not a particular one"},
 "in": {"prep": "inside or within a place, time, or state"},
 "to": {"prep": "showing the place, person, or thing that something moves toward"},
 "have": {"aux": "used with a past participle to form perfect tenses"},
 "it": {"pron": "used for a thing, animal, or situation already mentioned"},
 "i": {"pron": "used by a speaker to talk about himself or herself"},
 "that": {"pron": "used to point to a thing or person that is farther away", "conj": "used to introduce a clause that gives more information"},
 "for": {"prep": "intended to be given to or used by someone or something", "conj": "because; used to give a reason, in formal writing"},
 "you": {"pron": "used to talk to the person or people you are speaking to"},
 "he": {"pron": "used for a man or boy already mentioned"},
 "with": {"prep": "in the company of, or having, someone or something"},
 "on": {"prep": "touching and supported by the top of a surface"},
 "do": {"aux": "used to make questions and negative sentences"},
 "say": {"int": "used to get attention or show surprise"},
 "this": {"pron": "used for the person or thing near you or just mentioned"},
 "they": {"pron": "used for people or things already mentioned, more than one"},
 "at": {"prep": "in or near a particular place or time"},
 "but": {"conj": "used to introduce an opposite or surprising idea", "prep": "except; apart from"},
 "we": {"pron": "used by a speaker to talk about himself or herself and others"},
 "his": {"pron": "belonging to a man or boy already mentioned"},
 "from": {"prep": "showing the starting point of a place, time, or range"},
 "by": {"prep": "next to, or done by a person or thing"},
 "she": {"pron": "used for a woman or girl already mentioned"},
 "or": {"conj": "used to show a choice between things"},
 "as": {"conj": "while; at the time that; or in the same way that", "prep": "in the role or form of something"},
 "what": {"pron": "used to ask for information about a thing"},
 "their": {"pron": "belonging to them; of more than one person or thing"},
 "can": {"aux": "used to say that someone is able to or may do something"},
 "who": {"pron": "used to ask or say which person or people"},
 "if": {"conj": "used to talk about something that depends on something else"},
 "would": {"aux": "used to talk about what might happen or what someone planned"},
 "her": {"pron": "used for a woman or girl, as object or as owner"},
 "all": {"pron": "the whole number or amount of people or things"},
 "my": {"pron": "belonging to the speaker", "int": "used to show surprise"},
 "about": {"prep": "on the subject of someone or something"},
 "will": {"aux": "used to talk about things that are going to happen"},
 "up": {"prep": "toward or at a higher place"},
 "one": {"pron": "a single person or thing; any person in general", "num": "the number 1"},
 "there": {"int": "used to show you are pleased, or to comfort someone"},
 "so": {"conj": "for that reason; with the result that", "pron": "used to avoid repeating something already said"},
 "when": {"conj": "at the time that; while", "pron": "used to ask at what time"},
 "which": {"pron": "used to ask or show one thing out of a group"},
 "them": {"pron": "used for people or things already mentioned, as the object"},
 "some": {"pron": "an amount or number of people or things that is not stated"},
 "me": {"pron": "used by a speaker for himself or herself as the object"},
 "out": {"prep": "away from the inside of a place"},
 "into": {"prep": "to the inside of a place or thing"},
 "him": {"pron": "used for a man or boy already mentioned, as the object"},
 "your": {"pron": "belonging to the person you are speaking to"},
 "come": {"int": "used to encourage someone or to show you are annoyed"},
 "could": {"aux": "used to talk about what was possible or might happen"},
 "now": {"conj": "since; because something has just happened"},
 "than": {"conj": "used to compare two things or people", "prep": "used to compare with something else"},
 "like": {"prep": "similar to someone or something", "conj": "in the way that; as if"},
 "other": {"pron": "the ones that remain, or another person or thing"},
 "how": {"conj": "the way in which"},
 "then": {"conj": "after that; and as a result"},
 "its": {"pron": "belonging to a thing or animal already mentioned"},
 "our": {"pron": "belonging to the speaker and one or more other people"},
 "two": {"num": "the number 2"},
 "more": {"pron": "a greater amount or number of something"},
 "these": {"pron": "used for the people or things that are near you"},
 "first": {"num": "coming before all others in order or time"},
 "also": {"conj": "in addition to what has been said"},
 "because": {"conj": "for the reason that"},
 "man": {"int": "informal word used to show surprise or strong feeling"},
 "here": {"int": "used when you give something to someone"},
 "many": {"pron": "a large number of people or things"},
 "well": {"int": "used to start speaking or to show surprise"},
 "only": {"conj": "but; except that"},
 "those": {"pron": "used for people or things that are farther away"},
 "any": {"pron": "one or some, no matter which"},
 "through": {"prep": "from one end or side to the other"},
 "us": {"pron": "used for the speaker and other people, as the object"},
 "down": {"prep": "from a higher to a lower place"},
 "may": {"aux": "used to say that something is possible or allowed"},
 "after": {"prep": "later than a time or event", "conj": "at a time later than when something happens"},
 "should": {"aux": "used to say what is right or the best thing to do"},
 "over": {"prep": "above, across, or on the other side of something"},
 "still": {"conj": "even so; despite that"},
 "three": {"num": "the number 3"},
 "between": {"prep": "in the space or time separating two things"},
 "something": {"pron": "a thing that is not named or known"},
 "much": {"pron": "a large amount of something"},
 "while": {"conj": "during the time that; although"},
 "why": {"int": "used to show surprise or to begin an answer"},
 "same": {"pron": "exactly like another; not different"},
 "where": {"pron": "used to ask which place", "conj": "in or at the place that"},
 "might": {"aux": "used to say that something is possibly true or may happen"},
 "against": {"prep": "opposing someone or something; not in favor of"},
 "such": {"pron": "of the kind already mentioned"},
 "few": {"pron": "a small number of people or things"},
 "each": {"pron": "every one of two or more, taken separately"},
 "during": {"prep": "throughout a period of time"},
 "off": {"prep": "away from or no longer on something"},
 "without": {"prep": "not having or not with someone or something"},
 "before": {"prep": "earlier than a time or event", "conj": "earlier than the time when"},
 "must": {"aux": "used to say that something is necessary or very likely"},
 "under": {"prep": "below or lower than something"},
}
out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
lines = [json.dumps({"word": w, "defs": [{"pos": p, "text": t, "src": "hand"} for p, t in H[w].items()]},
                    ensure_ascii=False, separators=(",", ":")) + "\n" for w in sorted(H)]
out.write_bytes("".join(lines).encode("utf-8"))  # bytes: LF on Windows too
print(len(H), "words,", sum(len(v) for v in H.values()), "definitions")
````

- [ ] **Step 3: 取许可文本** — 把下面的脚本存成 `$env:TEMP\fetch_licences.py`(**不提交**)并在仓库根运行 `uv run --project server python -I $env:TEMP\fetch_licences.py server\dictionaries\wordbook-definitions`。它只下载两份小文本:ECDICT 的 `LICENSE`(MIT)和 CC BY 4.0 的纯文本法律文本;`LICENSE-OEWN` = 手写的归属说明 + CC BY 4.0 法律文本。**如果下载失败**:`LICENSE-OEWN` 只留归属说明加官方链接,并在提交信息里写明,不要手打法律文本;`LICENSE-ECDICT` 必须是上游文件原文:

```python
import sys
import urllib.request
from pathlib import Path

out = Path(sys.argv[1])
ECDICT = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE"
CC = "https://creativecommons.org/licenses/by/4.0/legalcode.txt"
ATTRIBUTION = """Open English WordNet 2025
https://en-word.net/  (https://github.com/globalwordnet/english-wordnet)

Definitions in definitions.jsonl (src "oewn") are taken from Open English WordNet 2025, which is licensed under the
Creative Commons Attribution 4.0 International License (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
Open English WordNet is derived from Princeton WordNet.

Changes made: only a selection and shortening of the original glosses (usage examples, quotations and long
parenthetical remarks removed; at most two senses per part of speech kept in WordNet's own order). Entries marked
src "hand" or "llm" were written for this project and are not part of Open English WordNet.

The full licence text follows.

----------------------------------------------------------------------

"""


def get(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (licence text fetch)"})  # CC answers 403 to urllib's default
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8").replace("\r\n", "\n").strip("\n") + "\n"


ecdict = get(ECDICT)
if "MIT License" not in ecdict or "Permission is hereby granted" not in ecdict:
    raise SystemExit("ECDICT LICENSE is not the MIT text; stop and look at it")
(out / "LICENSE-ECDICT").write_bytes(ecdict.encode("utf-8"))
try:
    legal = get(CC)
    if "Attribution 4.0 International" not in legal:
        raise ValueError("unexpected text")
except Exception as e:  # noqa: BLE001 - keep the attribution file even when the download fails
    print("CC BY 4.0 text not downloaded:", type(e).__name__, "- LICENSE-OEWN holds the attribution and the link only")
    legal = ""
(out / "LICENSE-OEWN").write_bytes((ATTRIBUTION + legal).encode("utf-8"))
print("ok")
```

- [ ] **Step 4: 根 `NOTICE` 追加两条** — 用下面的脚本(存成 `$env:TEMP\append_notice.py`,不提交)追加;它按文件现有的换行风格写,ECDICT 的版权行和 MIT 全文逐字取自 `LICENSE-ECDICT`(缩进两个空格,与已有 KyleBing 条目一致):

```python
from pathlib import Path

root = Path(".")
data = root / "server" / "dictionaries" / "wordbook-definitions"
notice_path = root / "NOTICE"
raw = notice_path.read_bytes().decode("utf-8")
nl = "\r\n" if "\r\n" in raw else "\n"
mit = (data / "LICENSE-ECDICT").read_text(encoding="utf-8").strip("\n").split("\n")
indented = "\n".join(("  " + line).rstrip() for line in mit)
block = f"""
English definitions (server/dictionaries/wordbook-definitions/)
  Source:  Open English WordNet 2025 - https://en-word.net/ (https://github.com/globalwordnet/english-wordnet)
  Used:    the English glosses of the words in the word books, shortened (usage examples and long parenthetical
           remarks removed, at most two senses per part of speech, kept in WordNet order), stored in definitions.jsonl
           (see SOURCE.json). Entries marked src "hand" or "llm" were written for this project.
  License: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
           Attribution and licence text: server/dictionaries/wordbook-definitions/LICENSE-OEWN
  Open English WordNet is derived from Princeton WordNet. Changes are described above.

ECDICT 1.0.28 (used only while building definitions.jsonl: word forms and frequency ranks; no ECDICT entry is redistributed)
  Source:  https://github.com/skywind3000/ECDICT (skywind3000)
  License: MIT License. Full text: server/dictionaries/wordbook-definitions/LICENSE-ECDICT

  ---- Full license text (verbatim from upstream LICENSE) ----

{indented}
"""
text = raw.rstrip("\r\n") + nl + block.replace("\n", nl)
notice_path.write_bytes(text.encode("utf-8"))
print("ok")
```

在仓库根运行:`uv run --project server python -I $env:TEMP\append_notice.py`。

- [ ] **Step 5: `.gitattributes`** — 在 `server/dictionaries/**/*.jsonl linguist-vendored` 之后加两行(用 Edit):

```
# Wordbook definitions: missing.txt is checksummed (binary); SOURCE.json keeps LF but stays diffable.
server/dictionaries/wordbook-definitions/*.txt binary
server/dictionaries/wordbook-definitions/SOURCE.json -text
```

- [ ] **Step 6: 目录 `CLAUDE.md`** — 创建 `server/dictionaries/wordbook-definitions/CLAUDE.md`:

```markdown
# server/dictionaries/wordbook-definitions/

English definitions shown under the Chinese meaning on wordbook cards (spec 2026-10-12-wordbook-definitions). Read at
runtime by `app/wordbook/definitions.py`; a missing or broken file silently means "no English definitions".

## What lives here
- `definitions.jsonl` – GENERATED by `scripts/wordbook_definitions.py build`: one line per word `{"word", "defs": [{"pos", "text", "src"}]}`,
  sorted by word, UTF-8, LF, at most 2 defs per part of speech. `pos` is `n v a r prep pron conj art num aux int`; `src` is `oewn | hand | llm`.
- `function-words.jsonl` – HAND-WRITTEN (`src: "hand"`): the most frequent function words. The only file here you edit by hand.
- `definitions-llm.jsonl` – written only by `llm-fill` (`src: "llm"`); absent until the LLM upstream has been used (plan L1).
- `missing.txt` – GENERATED gap list `word<TAB>pos,pos<TAB>category<TAB>frq` (function / abbr / proper / compound / pos_mismatch / other).
- `SOURCE.json` – GENERATED manifest: input names, versions, sha256, rules, file checksums, counts.
- `LICENSE-OEWN`, `LICENSE-ECDICT` – licence texts (also in the root `NOTICE`).

## Rules
- Never edit generated files by hand; change the script or the inputs and rebuild (`server/scripts/CLAUDE.md`). Commit a rebuild alone:
  `chore(server): update wordbook English definitions (<reason>)`.
- `.gitattributes` marks `*.jsonl` and `missing.txt` as `binary` (checksums stay stable on Windows).
- Build inputs (OEWN zip, ECDICT zip) are NOT in the repo; they are checked by sha256 (`wordbook_definitions.py verify`).
- Function words (`in`, `it`, `a` ...) must never come from WordNet: `build` skips WordNet for `prep pron conj art num aux int`.
- The runtime finds this folder next to the word-book folder (`<WORDBOOK_DATA_DIR>/../wordbook-definitions/`). If you point
  `WORDBOOK_DATA_DIR` elsewhere, put this folder beside it, otherwise cards silently have no English definitions.
- Copied into the image by `server/Dockerfile` (`/app/dictionaries`); whitelisted by `!server/dictionaries` in `Dockerfile.dockerignore`.

## Test
`uv run pytest -q tests/test_wordbook_definitions_data.py tests/test_wordbook_definitions_build.py`
```

- [ ] **Step 7: 运行** — `cd server && uv run pytest -q tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿(84 个)。

- [ ] **Step 8: 提交**

```
git add server/dictionaries/wordbook-definitions/function-words.jsonl server/dictionaries/wordbook-definitions/LICENSE-OEWN server/dictionaries/wordbook-definitions/LICENSE-ECDICT server/dictionaries/wordbook-definitions/CLAUDE.md NOTICE .gitattributes server/tests/test_wordbook_definitions_build.py
git commit -m "chore(server): licences, NOTICE entries and hand-written function words for wordbook definitions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Lane Z · 文档、真实构建、数据测试

### Task Z1: 文档同步

**Files:**
- Modify: `server/dictionaries/CLAUDE.md`、`server/app/wordbook/CLAUDE.md`、`server/scripts/CLAUDE.md`、`server/CLAUDE.md`、`server/tests/CLAUDE.md`、`server/app/routers/CLAUDE.md`

(`server/app/CLAUDE.md` **不改**:分层表和依赖规则没有变化,`wordbook` 行的描述已经覆盖。)

- [ ] **Step 1: `server/dictionaries/CLAUDE.md`** — 「What lives here」加一条;「Rules」里 `.gitattributes` 那条后加一句:

```markdown
- `wordbook-definitions/` – English definitions for word cards (generated + hand-written + licences; see its own `CLAUDE.md`).
```

```markdown
- `wordbook-definitions/` is generated by `scripts/wordbook_definitions.py` (not byte-identical to an upstream file); its checksums live in its own `SOURCE.json`.
```

- [ ] **Step 2: `server/app/wordbook/CLAUDE.md`** — 「What lives here」加:

```markdown
- `definitions.py` – English definitions (spec `2026-10-12-wordbook-definitions-design.md`): `Definitions` lazy-loads `dictionaries/wordbook-definitions/definitions.jsonl`
  into a dict keyed by normalized word (stdlib only; a missing/broken file = no English definitions); `select_defs` keeps ≤ 2 per POS, ≤ 4 in total.
```

「Pitfalls」末尾加:

```markdown
- English definitions: `service.card_out(card, ds)` is the only place a card object is built (6 call sites, `ds` is required so a missed one fails loudly);
  `defs_en` is added only when non-empty. The loader never logs words, never imports anything but the stdlib, and never calls the network or an LLM
  (`tests/test_wordbook_definitions.py` pins it). The file is found beside the book directory (`<data dir>/../wordbook-definitions/`).
- `def_lang` (both | zh | en, default both) is per user, stored as `wordbook_events` rows `kind="defpref"`, `book_id=""`, `outcome=<value>` (latest wins;
  plan R-DS3: there is no per-user wordbook settings table or JSON column and no migration). It is read by `GET /config` only and written by
  `PATCH /enrollment {"def_lang": ...}` (alone it needs no active book; an unchanged value writes nothing and costs no settings quota). Rank, the plan and
  the admin per-book counts never see these rows: keep `book_id=""` and never add `defpref` to a kind list.
- The contract fixture records `defs_en` (a mini definitions file via `tests.wordbook_helpers.make_defs_dir`) and `def_lang`; only its shape is stable
  (random user ids shape option order, timestamps): web must check keys/shape plus `defs_en` and `def_lang`, not other values.
```

- [ ] **Step 3: `server/scripts/CLAUDE.md`** — 「What lives here」加(并在「Pitfalls」补一条环境变量):

```markdown
- `wordbook_definitions.py` – offline builder of `dictionaries/wordbook-definitions/` (`verify`, `build`, `check`, `llm-fill`); inputs: the OEWN 2025 and ECDICT 1.0.28 zips under `--sources` / env `WORDBOOK_DEFS_SOURCES` (not in the repo); output is byte-deterministic; `llm-fill` is dev-machine only and stops cleanly on a 402 (tests: `tests/test_wordbook_definitions_build.py`; `app/` never imports it)
```

```markdown
- `wordbook_definitions.py build` needs `WORDBOOK_DEFS_SOURCES` (a folder holding `english-wordnet-2025-index.sense-fixed.zip` and `ecdict-sqlite-28.zip`, found recursively) and the 851 MB `stardict.db` (reused if already extracted under it, else extracted to `--work`). `llm-fill` reads `server/.env` (`UPSTREAM_LLM_*`), prints only counts, writes `definitions-llm.jsonl` and a spot-check report outside the repo.
```

- [ ] **Step 4: `server/CLAUDE.md`** — `dictionaries/` 那条改为:`committed third-party word books and generated English definitions read at runtime by `app/wordbook/` (byte-exact / checksummed; see `dictionaries/CLAUDE.md`, repo-root `NOTICE`)`;`scripts/` 那条后补 `wordbook_definitions.py builds/verifies the English definitions`。

- [ ] **Step 5: `server/tests/CLAUDE.md`** — 在 `fixtures/` 条目之前加一条:

```markdown
- `wordbook_helpers.py` – `make_data_dir` / `enable_wordbook` for the mini word book and `make_defs_dir` (a mini `wordbook-definitions/definitions.jsonl` beside it; without it cards have no `defs_en`); `test_wordbook_definitions*.py` and `test_wordbook_def_lang.py` cover the English definitions
```

- [ ] **Step 6: `server/app/routers/CLAUDE.md`** — `wordbook` 条目里 `config` 后补:`config (incl. the per-user def_lang)`,并在 `enrollment` 后补 `PATCH /enrollment also takes def_lang`。

- [ ] **Step 7: 提交**

```
git add server/dictionaries/CLAUDE.md server/app/wordbook/CLAUDE.md server/scripts/CLAUDE.md server/CLAUDE.md server/tests/CLAUDE.md server/app/routers/CLAUDE.md
git commit -m "docs(server): document wordbook English definitions, def_lang and the builder" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task Z2: 在真实输入上构建、核对、抽查,数据独占一个提交

**Files:**
- Create(生成):`server/dictionaries/wordbook-definitions/definitions.jsonl`、`missing.txt`、`SOURCE.json`

**前置:** 输入在 `D:\tmp-ecdict\`(`ewn\english-wordnet-2025-index.sense-fixed.zip`、`dl\ecdict-sqlite-28.zip`,以及已解压的 `x\stardict.db`);D1 已合并(手写表、许可文件在位)。

- [ ] **Step 1: 校验输入** — `cd server; $env:WORDBOOK_DEFS_SOURCES='D:\tmp-ecdict'; uv run python scripts/wordbook_definitions.py verify` → 打印 `ok`。不是 `ok` 就停:输入文件不对,不要继续。

- [ ] **Step 2: 构建** — `uv run python scripts/wordbook_definitions.py build --built 2026-10-12`(约 6 秒)。写计划时在同一份输入、同一份代码上的结果如下,**执行者的输出应当逐项相同**;不同先查原因(输入、代码或手写表被改过),不要调数字:

```
words_wanted 14615      words_with_defs 14019     words_with_oewn 13979     defs 29158
pairs: oewn 17837, hand 116, llm 0                partial_open_pos 1320     gaps 757
gap_categories: function 229, proper 105, abbr 14, compound 23, pos_mismatch 45, other 341
```

和 spec §2 的对照:spec 数的是 14,625 个原始小写词(含 `adj.` 这类被 `BookIndex` 丢弃的写法);`headword_key` 过滤后是 14,615 个键。按词性命中 WordNet 的词 spec 测得 13,924(95.2%),这里 13,979(95.7%)——多出的 55 个来自 WordNet 不规则变形表和 ECDICT 原形(R-DS11);加上手写表后 14,019 个词(95.9%)有英文释义。零释义的词 596 个(14,615 − 14,019);大模型候选(`function`、`compound`、`pos_mismatch`、`other` 四类,去掉没有词性的行)约 630 个,和 spec 的「约 700」同量级。

- [ ] **Step 3: 确定性与自检** — 记下三个文件的哈希,再构建一次,哈希必须相同:

```
Get-FileHash server\dictionaries\wordbook-definitions\definitions.jsonl,server\dictionaries\wordbook-definitions\missing.txt,server\dictionaries\wordbook-definitions\SOURCE.json -Algorithm SHA256
uv run python scripts/wordbook_definitions.py build
Get-FileHash ... (同上)
uv run python scripts/wordbook_definitions.py check
```

三个哈希前后一致,`check` 打印 `ok`。

- [ ] **Step 4: 抽查 30 个随机词** — 存成 `$env:TEMP\spot.py`(不提交)并运行 `uv run python -I $env:TEMP\spot.py server\dictionaries\wordbook-definitions server\dictionaries\kylebing-english-vocabulary 12`(固定种子 12;想多看就换种子):

````python
import json
import random
import sys
from pathlib import Path

data, books = Path(sys.argv[1]), Path(sys.argv[2])
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 12
rows = [json.loads(line) for line in (data / "definitions.jsonl").read_text(encoding="utf-8").splitlines()]
zh: dict[str, list[str]] = {}
for book in ("junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat"):
    for line in (books / f"{book}.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        zh.setdefault(row["word"].strip().lower(), [t["translation"] for t in row.get("translations", [])[:2]])
for row in random.Random(seed).sample(rows, 30):
    print(row["word"], "|", " / ".join(zh.get(row["word"], [])))
    for d in row["defs"]:
        print("   ", d["pos"], d["src"], d["text"])
````

逐个对照中文释义。判定口径:英文行大体对得上词义、不含例句残留、不含明显错词(如 `in` 的第一条不是「铟」)即算通过;**≥ 27/30 通过才提交**。已知的、设计已接受的瑕疵:WordNet 的第一义偶尔和中文第一义对不上(`stamp` 名词第一条是「事物的独特形式」)、个别释义很长(> 14 词时排在同词性短的后面)、少数是分类学说明(`tomato` 第二条「native to South America」)。把抽查结果(通过数、发现的问题)写进提交信息正文;不要编造数字。

- [ ] **Step 5: 看一眼缺口清单** — `Get-Content server\dictionaries\wordbook-definitions\missing.txt -TotalCount 15` 与 `... | Select-String -Pattern "\tproper\t" | Select-Object -First 10`:`function` 在前、专有名词是国家/城市/人名。

- [ ] **Step 6: 只提交三个生成文件** — `git status --short` 应只多出这三个文件(以及之前就在的未跟踪文件);`git add` 这三个,提交信息固定:

```
git add server/dictionaries/wordbook-definitions/definitions.jsonl server/dictionaries/wordbook-definitions/missing.txt server/dictionaries/wordbook-definitions/SOURCE.json
git commit -m "chore(server): add wordbook English definitions (OEWN 2025)" -m "Built by scripts/wordbook_definitions.py build from Open English WordNet 2025 (CC BY 4.0) with ECDICT 1.0.28 lemmas; hand-written function words; LLM gap-fill pending (upstream 402). Spot check: <通过数>/30 acceptable." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(把 `<通过数>` 换成 Step 4 的真实结果后再提交。)

### Task Z3: 数据文件测试与全量验证

**Files:**
- Create: `server/tests/test_wordbook_definitions_data.py`

**Interfaces:** 校验提交的数据:校验和(`wd.check`)、条目数范围、每行 schema、已排序、无空释义、键是 `BookIndex` 的键、虚词词性没有 WordNet 来源、手写表、`missing.txt` 排序、运行时加载器能读它、许可 / `NOTICE` / `.gitattributes` / Docker 接线、LF 无 BOM、无密钥形状的文本。

- [ ] **Step 1: 写测试** — 创建 `server/tests/test_wordbook_definitions_data.py`:

````python
"""The committed English-definitions data (spec 2026-10-12-wordbook-definitions §3, §6): checksums, schema, licences, wiring.
Real files; the inputs they were built from are not in the repo, so rebuilding is a manual step (server/scripts/CLAUDE.md)."""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

from app.wordbook.definitions import Definitions

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent
DATA = SERVER / "dictionaries" / "wordbook-definitions"
BOOKS = SERVER / "dictionaries" / "kylebing-english-vocabulary"


def _script():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _script()


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    return [json.loads(line) for line in (DATA / "definitions.jsonl").read_text(encoding="utf-8").splitlines()]


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((DATA / "SOURCE.json").read_text(encoding="utf-8"))


def test_manifest_matches_the_committed_files(manifest):
    assert wd.check(DATA) == []
    assert [i["id"] for i in manifest["inputs"]] == ["oewn", "ecdict", "books"]
    assert manifest["inputs"][0]["sha256"] == wd.INPUTS["oewn"]["sha256"] and manifest["inputs"][1]["license"] == "MIT"
    assert {f["file"] for f in manifest["files"]} >= {"definitions.jsonl", "missing.txt", "function-words.jsonl"}
    assert max(f["bytes"] for f in manifest["files"]) < 50 * 1024 * 1024
    assert manifest["rules"]["closed_pos_from_wordnet"] is False and manifest["script_version"] == wd.SCRIPT_VERSION


def test_entry_count_and_sources_agree_with_the_manifest(rows, manifest):
    stats = manifest["stats"]
    assert len(rows) == stats["words_with_defs"] and sum(len(r["defs"]) for r in rows) == stats["defs"]
    assert 13_900 <= stats["words_with_oewn"] <= 14_100  # spec §2 measured 13,924 before lemma resolution
    assert stats["words_with_defs"] / stats["words_wanted"] >= 0.95
    by_src = {s: sum(1 for r in rows for d in r["defs"] if d["src"] == s) for s in wd.SRC_VALUES}
    assert by_src["oewn"] > 25_000 and by_src["hand"] >= 60 and by_src["llm"] == stats["pairs"]["llm"]  # the model writes one def per POS


def test_every_row_is_valid_sorted_and_has_a_definition(rows):
    assert wd.definitions_problems(DATA / "definitions.jsonl") == []
    words = [r["word"] for r in rows]
    assert words == sorted(words) and len(set(words)) == len(words)
    for r in rows:
        assert r["defs"] and all(d["text"].strip() and d["pos"] in wd.ALL_POS and d["src"] in wd.SRC_VALUES for d in r["defs"])


def test_keys_are_book_index_keys_and_cover_the_books(rows):
    wanted, _ = wd.collect_wanted(BOOKS)
    keys = {r["word"] for r in rows}
    assert keys <= set(wanted)  # nothing for words no book has
    assert len(keys) / len(wanted) >= 0.95


def test_wordnet_never_supplies_a_closed_class_definition(rows):
    assert not [(r["word"], d["pos"]) for r in rows for d in r["defs"] if d["pos"] in wd.CLOSED_POS and d["src"] == "oewn"]


def test_hand_written_function_words(rows):
    hand = [json.loads(l) for l in (DATA / "function-words.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(hand) >= 60 and [h["word"] for h in hand] == sorted(h["word"] for h in hand)
    for h in hand:
        for d in h["defs"]:
            assert d["src"] == "hand" and d["pos"] in wd.CLOSED_POS and len(d["text"].split()) <= wd.LLM_MAX_WORDS
    got = {r["word"]: r["defs"] for r in rows}
    assert got["in"][0]["src"] == "hand" and got["in"][0]["pos"] == "prep"  # not the WordNet noun (indium)
    assert any(d["pos"] == "art" for d in got["the"]) and any(d["pos"] == "pron" for d in got["it"])


def test_missing_list_has_no_function_word_that_hand_covers_and_is_sorted(manifest):
    lines = (DATA / "missing.txt").read_text(encoding="utf-8").splitlines()
    parsed = [l.split("\t") for l in lines]
    assert all(len(p) == 4 and p[2] in wd.CATEGORIES for p in parsed)
    assert {p[0] for p in parsed}.isdisjoint({"the", "in", "of", "and", "to"})
    order = {c: i for i, c in enumerate(wd.CATEGORIES)}
    assert [order[p[2]] for p in parsed] == sorted(order[p[2]] for p in parsed)
    assert len(parsed) == manifest["stats"]["gaps"]


def test_the_runtime_loader_reads_the_committed_file(rows, manifest):
    d = Definitions(DATA / "definitions.jsonl")
    assert len(d) == len(rows)
    assert d.defs_for("stamp") and all(set(x) == {"pos", "text"} for x in d.defs_for("stamp"))
    assert len(d.defs_for("round")) <= 4 and d.defs_for("zebraxyz") == []


def test_licences_notice_gitattributes_and_docker_wiring():
    oewn = (DATA / "LICENSE-OEWN").read_text(encoding="utf-8")
    assert "Open English WordNet" in oewn and "CC BY 4.0" in oewn and "https://creativecommons.org/licenses/by/4.0/" in oewn
    ecdict = (DATA / "LICENSE-ECDICT").read_text(encoding="utf-8")
    assert "MIT License" in ecdict and "Permission is hereby granted" in ecdict
    copyright_line = next(l.strip() for l in ecdict.splitlines() if l.strip().lower().startswith("copyright"))
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "Open English WordNet" in notice and "Creative Commons Attribution 4.0" in notice
    assert "ECDICT" in notice and "skywind3000" in notice and copyright_line in notice and "Permission is hereby granted" in notice
    assert "KyleBing/english-vocabulary" in notice  # the earlier entry is still there
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "server/dictionaries/**/*.jsonl binary" in attrs and "server/dictionaries/wordbook-definitions/*.txt binary" in attrs
    assert "COPY server/dictionaries /app/dictionaries" in (SERVER / "Dockerfile").read_text(encoding="utf-8")
    assert "!server/dictionaries" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()
    assert (DATA / "CLAUDE.md").is_file()


def test_files_are_lf_without_bom():
    for name in ("definitions.jsonl", "function-words.jsonl", "missing.txt", "SOURCE.json"):
        raw = (DATA / name).read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf") and b"\r" not in raw and raw.endswith(b"\n"), name


def test_no_secret_shaped_text_in_the_data_dir():
    pattern = re.compile(r"(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s*[:=])", re.I)
    for path in DATA.iterdir():
        if path.suffix in {".jsonl", ".txt", ".json", ".md"} or path.name.startswith("LICENSE"):
            assert not pattern.search(path.read_text(encoding="utf-8")), path.name
````

- [ ] **Step 2: 运行** — `cd server && uv run pytest -q tests/test_wordbook_definitions_data.py` → 11 个全绿。若 `test_licences_notice_gitattributes_and_docker_wiring` 失败,多半是 D1 的 NOTICE 或 `.gitattributes` 没提交完整。

- [ ] **Step 3: 测一次首次加载的耗时与内存并记录** — `uv run python -c "import time,tracemalloc; from pathlib import Path; from app.wordbook.definitions import Definitions; tracemalloc.start(); t=time.perf_counter(); d=Definitions(Path('dictionaries/wordbook-definitions/definitions.jsonl')); n=len(d); print(n, round((time.perf_counter()-t)*1000), 'ms', round(tracemalloc.get_traced_memory()[0]/1048576,1), 'MiB')"`。写计划时的结果:14,019 个词、约 191 ms、约 5.7 MiB;执行者把自己的数字写进提交信息。远超 1 秒或 20 MiB 就回头看 `_load`。

- [ ] **Step 4: 全量** — `cd server && uv run pytest -q`(约 2.5 分钟;被限时就拆成两半,按文件)。确认 `git status` 里没有多余文件(如 `.pytest_cache` 以外的)。

- [ ] **Step 5: 提交**

```
git add server/tests/test_wordbook_definitions_data.py
git commit -m "test(server): pin the committed wordbook definitions data, licences and wiring" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 交接** — 告诉主会话:构建输入 `D:\tmp-ecdict\` 现在可以清理(spec §6);网页计划可以开始读 `server/tests/fixtures/wordbook_contract.json`。

---

## Lane L · 大模型补缺口(**BLOCKED:等 LLM 上游余额恢复**)

### Task L1: 跑 `llm-fill`、抽查、合并、提交

> **状态:BLOCKED。** 上游 LLM 当前回 402(余额不足)。**功能不依赖这一步**:缺口词(没有 WordNet 释义的约 600 个词)暂时不显示英文释义,手写表已经覆盖最常见的 103 个虚词。余额恢复后,在开发机上按下面做;运行时代码不变,只是数据多一个文件、`definitions.jsonl` 多几百条 `src: "llm"`。

**Files:**
- Create: `server/dictionaries/wordbook-definitions/definitions-llm.jsonl`
- Modify(重新生成):`definitions.jsonl`、`missing.txt`、`SOURCE.json`

- [ ] **Step 1: 探测余额(一批,约 40 个词)** — `cd server; uv run python scripts/wordbook_definitions.py llm-fill --max-batches 1`。输出 `llm-fill stopped: upstream answered http 402 ...`(退出码 3)= 仍然 BLOCKED,到此为止;输出 JSON 报告 = 余额恢复。

- [ ] **Step 2: 跑完(可随时中断再续)** — 精确命令:

```
cd server
uv run python scripts/wordbook_definitions.py llm-fill --report $env:TEMP\wordbook-defs-llm-spotcheck.txt
```

约 16 批。进度每批写进 `server/dictionaries/wordbook-definitions/definitions-llm.jsonl`;中途 402 或断网会停下(退出码 3),再跑同一条命令从剩下的词继续(已写入的词不再问)。报告 JSON 里 `bad_batches` 不为 0 说明模型回了不合格的 JSON,那些词留在队列里,再跑一次即可;反复不合格的词可以手写进 `function-words.jsonl`。

- [ ] **Step 3: 人工抽查(5%)** — 看 `$env:TEMP\wordbook-defs-llm-spotcheck.txt`(固定种子的约 5% 条目,每行 `词<TAB>词性<TAB>释义`)。口径同 Z2:词义对、≤ 12 个词、简单词汇、不含中文、不循环(释义里不直接用词本身)。通过率 ≥ 90% 才合并;低于就把提示词(`SYSTEM_PROMPT`)修一修,删掉 `definitions-llm.jsonl` 重跑,并补一个解析测试。结果写进提交信息,不要编数字。

- [ ] **Step 4: 合并重建** — `$env:WORDBOOK_DEFS_SOURCES='D:\tmp-ecdict'; uv run python scripts/wordbook_definitions.py build`(`--built` 不给:内容变了,日期取今天)→ `uv run python scripts/wordbook_definitions.py check` → `ok`。`gap_categories.function` 应降到 0、`pairs.llm` 约等于被填的(词, 词性)数。

- [ ] **Step 5: 测试** — `cd server && uv run pytest -q tests/test_wordbook_definitions_data.py tests/test_wordbook_definitions_build.py tests/test_wordbook_definitions.py`(数据测试里 `by_src["llm"] == stats.pairs.llm` 此时才有非零值)。

- [ ] **Step 6: 提交**

```
git add server/dictionaries/wordbook-definitions/
git commit -m "chore(server): add LLM-written English definitions for wordbook gaps" -m "llm-fill batches of 40, strict JSON, spot check <通过数>/<抽查数>." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## 验证矩阵

| 要验证的事 | 怎么验证 | 写计划时的状态 |
|---|---|---|
| 词性映射(含 `a&ad`、`ad&prep`、`modal verb`、`abbr`、乱码) | `test_map_pos`(28 个参数) | 已在副本运行,通过 |
| 虚词词性不走 WordNet | `test_build_never_uses_wordnet_for_closed_class_pos`、Z3 `test_wordnet_never_supplies_a_closed_class_definition` | 前者已运行;后者待 Z3 |
| 释义清洗(例句、引号、长括号、嵌套括号、不配对括号) | `test_clean_gloss`(11 个参数) | 已运行,通过 |
| > 14 词稳定后排、去重、每词性 2 条 | `test_pick_texts_*`、`test_build_picks_two_per_pos_...` | 已运行,通过 |
| 词形还原(WordNet `*.exc`、ECDICT `exchange`) | `test_build_resolves_lemmas_...` | 已运行,通过 |
| 缺口分类与计数、`missing.txt` 排序 | `test_build_lists_gaps_...`、`test_missing_txt_is_sorted_...` | 已运行,通过 |
| 输出确定性(字节相同、日期规则) | `test_build_is_byte_identical_...`;真实输入上连跑两次哈希相同 | 已在真实输入上运行 |
| `SOURCE.json` 写出/校验、篡改检测 | `test_manifest_matches_the_files_...` | 已运行,通过 |
| `verify` 对输入哈希 | `test_verify_reports_...`;真实输入 `verify` 打印 ok | 已运行 |
| 手写表严格校验、手写 > WordNet > 大模型 | `test_hand_*`、`test_llm_rows_fill_only_...` | 已运行,通过 |
| `llm-fill`:批 40、严格 JSON、续跑、402 停止、抽样、合并 | `test_run_fill_*`、`test_parse_reply_is_strict`、`test_fill_then_build_...`、`test_real_client_...`(respx) | 已用假模型运行,通过;**真实上游未验证** |
| 加载器:缺失/坏行/重载/并发/预热/只用标准库 | `tests/test_wordbook_definitions.py`(前 12 个) | 已运行,通过 |
| 每个构造卡片的地方带 `defs_en`(每词性 ≤ 2、总共 ≤ 4) | `tests/test_wordbook_definitions.py`(端点部分,7 个) | 已运行,通过 |
| `def_lang`:默认、保存、422、按用户、不扣次数、事件不影响计划/段位/管理端 | `tests/test_wordbook_def_lang.py`(22 个) | 已运行,通过 |
| 契约夹具(形状 + `defs_en` + `def_lang`) | `tests/test_wordbook_contract.py`(重录 8 次都通过) | 已运行,通过 |
| 架构不放宽 | `tests/test_architecture.py` | 已运行,通过 |
| 回归 | `tests/test_wordbook_*.py`、`test_rank_wordbook.py`、`test_admin_wordbook.py`、`test_links_word_actions.py` | 482 个,已在副本运行,通过 |
| 真实数据:数字、抽查、校验和、许可、接线 | Z2、Z3 | **待执行** |
| 首次加载耗时与内存 | Z3 Step 3 | 计划作者机器上测过一次(约 191 ms、5.7 MiB) |

## 未验证清单(如实)

- **真实 LLM 上游**:`llm-fill` 只用假模型和 respx 测过;提示词、批大小、`max_tokens=4000` 在真实模型上的效果、通过率都没测(上游 402)。
- **Postgres**:`get_def_lang` / `set_def_lang`(`wordbook_events` 的查询与插入)只在 SQLite 上跑过;`order_by(id desc).limit(1)` 和 `book_id = ''` 的过滤在 Postgres 上应无差别,但没跑。
- **许可文本**:`LICENSE-ECDICT` 来自上游 `LICENSE`(写计划时读到的版权行是 `Copyright (c) 2025 Linwei`,不是 spec 里说的 `skywind3000`——后者是仓库作者的 GitHub 名;以文件原文为准,`NOTICE` 同时写了项目地址和这个名字);`LICENSE-OEWN` 的归属措辞是计划作者按 CC BY 4.0 的要求(署名、许可链接、是否修改)写的,**没有对照 OEWN 2025 发行版自带的 LICENSE 文件**(钉住的 zip 里没有),也没有复制 Princeton WordNet 自己的版权声明;提交前请对照 en-word.net 的署名要求。`SOURCE.json` 里输入只记了主页,没有记下载 URL(输入文件是事先下载好的,计划作者没有可靠的下载地址)。
- **手写表的 116 条**没有第二个人审过;**真实构建**的抽查由 Z2 执行,不是计划作者做的。
- **真机 / 真实浏览器 / 网页消费**:不在本计划;网页计划负责。
- **生产容器里的首次加载耗时**:只在开发机上测过。
- **多进程部署**:每个进程各加载一份(约 6 MiB),没有测;镜像默认单 worker。

## 不做

- 英英选择题、让大模型给全部 1.46 万个词逐个挑义项、运行时调用任何词典 / LLM、释义按用户水平改写、专有名词的英文释义、把词典 API 接进网页(spec §7)。
- 给开放词性的局部缺口(1,320 个词)补英文行(R-DS2)。
- 管理端诊断里加「释义文件缺失」提示、管理端查看 / 编辑 `def_lang`(R-DS16)。
- 新增设置项(释义目录、开关);新增迁移;把偏好搬到真正的表(R-DS3 写明代价)。
- 改 `enjoy/`、`web/`、`server/app/CLAUDE.md`、分层测试。

## 跨计划假设(网页计划依赖的确切线上字段)

1. **卡片对象**(下列位置里每一个卡片对象)新增**可选**键 `defs_en`:
   `[{"pos": "n", "text": "..."}]`——键缺省 = 没有英文释义(不是空数组);出现时非空。位置:`POST /api/wordbook/learn/batch` → `cards[]`;`POST /api/wordbook/review/batch` → `cards[]`;`POST /api/wordbook/spell/submit` → `words[].card`;`GET /api/wordbook/cards/{book_id}/{key}` → 顶层就是卡片对象;`POST /api/wordbook/learned/card` → 顶层就是卡片对象;`POST /api/wordbook/free/start` → `items[].card`;`POST /api/links/wordbook/card` → `card`。`learned/query` 的列表项没有卡片对象,不变。原有键(`key word us uk senses phrases examples`)一个不少。
2. **`defs_en` 的内容规则:** `pos` ∈ `n v a r prep pron conj art num aux int`(`a` = 形容词、`r` = 副词;界面标签由网页映射);同一词性的条目相邻、按文件顺序;每个词性 ≤ 2 条、总共 ≤ 4 条;词性顺序是书里给这个词的词性顺序(第一条中文释义的词性通常排前面,但不保证和中文行一一对应——「接受它和中文第一义偶尔对不上」)。`text` 是纯英文文本(无标记、无中日韩字符);WordNet 来源的单条最长约 42 个词(绝大多数 ≤ 14),界面要允许换行或截断;手写 / 大模型来源 ≤ 12 个词。
3. **`def_lang` 的读取:** `GET /api/wordbook/config` 响应多一个顶层键 `"def_lang": "both" | "zh" | "en"`(默认 `"both"`)。开关关闭时响应仍是 `{"enabled": false}`,没有该键(网页要容忍缺省并当作 `both`)。
4. **`def_lang` 的写入:** `PATCH /api/wordbook/enrollment`,JSON 体 `{"def_lang": "both" | "zh" | "en"}`。可以单独发,**不需要有在学的书**;也可以和 `daily_new / review_cap / review_unlimited / order_mode` 一起发(只扣一次「设置」配额)。成功 200,响应 = 原有的 enrollment 对象(有在学的书时)**再加** `"def_lang": "<值>"`;没有在学的书时响应是 `{"def_lang": "<值>"}`。体里没有 `def_lang` 时响应与以前逐字相同。未知值(或非字符串、`null` 单独发)→ HTTP 422;429 `Too many settings changes today` 与每日目标共用配额(每人每 UTC 日 60 次;值没变不写、不扣)。`PATCH` 响应里的 `def_lang` 可以直接当作新的偏好,不必重新取 `/config`。
5. **契约夹具** `server/tests/fixtures/wordbook_contract.json`(P1 合并后):`config.def_lang` 是 `"both"`;新键 `def_lang_patch`(`{... enrollment 字段, "def_lang": "en"}`);`learn_batch.cards[0]`、`review_batch.cards[0]`、`card`、`learned_card`、`free_start.items[0].card`、`spell_submit.words[0].card` 都带 `defs_en`(每项 `{pos, text}`)。夹具里**只有形状稳定**:其他值(选项顺序、时间戳、用户派生的随机量)每次重录都会变,网页契约测试不得依赖它们(R-DS6)。
6. **不变:** 题面、选项、拼写、快速回忆仍然只用中文;`learned/query` 的搜索与列表不变;不新增端点、不新增 URL 参数;任何词都不进 URL。
