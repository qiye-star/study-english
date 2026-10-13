# 选词词典 · 操作条 · 词形表(服务端 + 网页)Implementation Plan(计划 B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中单词后底部出现一排小操作条「查词 · 朗读 · 加入生词本」;查词先问服务端本地词典(七本词书 + 英文释义 + 词形还原 + 短语表),命中立即显示并标「词典」,抽屉里另有「AI 结合语境讲解」按钮;未命中(或词典请求失败)自动走现有大模型路径并标「AI 查询」;朗读在点击手势里调用(iOS)。长句翻译路径不变。

**Architecture:** 服务端新增 `POST /api/dictionary/lookup`(词只在请求体)。模块放 **`app/wordbook/`**(`forms.py` 词形表加载器、`lookup.py` 查询编排),路由放新文件 `app/routers/dictionary.py`:wordbook 层只许 core/models/providers/speech/services 且只被 admin/routers/main 导入,新代码正好满足,`tests/test_architecture.py` 一字不改(R-L1)。词形表 `forms.txt` 由 `scripts/wordbook_definitions.py forms` 从 ECDICT `exchange` 离线生成,提交进 `server/dictionaries/wordbook-definitions/`。网页:`lookup-layer.tsx` 的触发按钮换成操作条;「加入生词本」继续是 `<WordActions>` 插槽;「朗读」是**新扩展点 `selectionActions`**,由 chat 的 `register-selection-actions.tsx` 贡献(核心贡献,永远可见),不新增 lookup→chat 依赖(R-L5)。

**Tech Stack:** FastAPI + pydantic v2 + pytest(服务端,标准库为主);React 18 + vitest(网页)。不新增依赖、不新增迁移、不改 `enjoy/`。

**Spec:** `docs/superpowers/specs/2026-10-13-defs-default-lookup-ios-design.md` §1(D4–D7)、§3(本计划实现 §3.2–§3.4)。并行计划:A `2026-10-13-defs-default.md`(`features/wordbook` 的 def_lang 文件)、C `2026-10-13-ios-keyboard-scroll.md`(`layout/` + 输入框样式)。合并顺序 A → B → C。

## Global Constraints

- **隐私:** 查询的词只在 POST 体;不进 URL、日志、错误体(422 只回字段名与规则)、契约夹具之外的任何持久化;不写库、不新增迁移(`alembic heads` 不变)。新模块里**没有 logging 调用**(forms 加载器只记「跳过 N 行」)。`caplog` 测试守着。
- **分层:** `tests/test_architecture.py`、`web/src/architecture.test.ts` 都不放宽(`CROSS_FEATURE_BASELINE` 仍是 18 条,不加边)。
- **不改 `enjoy/`;** 不向第三方发请求(词典只在 `server/`)。
- **数据文件变了就要同步:** `SOURCE.json`(脚本生成)、`NOTICE`、`server/dictionaries/wordbook-definitions/CLAUDE.md`、`server/dictionaries/CLAUDE.md`、校验和测试。`Dockerfile`(`COPY server/dictionaries`)与 `Dockerfile.dockerignore`(`!server/dictionaries`)**不用改**:新文件在已有白名单目录内(`test_wordbook_forms_data.py` 断言这两行仍在);`.gitattributes` 的 `server/dictionaries/wordbook-definitions/*.txt binary` 已覆盖 `forms.txt`。
- **工作树是 CRLF:** 改现有文件用 Edit 工具,新文件用 Write;数据文件由脚本以字节写出(LF)。
- **提交:** conventional,一任务一提交,每个提交后相关测试全绿,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。**数据提交(S2)独占一个提交**:`chore(server): add wordbook word-form table (ECDICT exchange)`。
- **只在用户要求时:** 重建容器、跑全量测试、跑 E2E(会花钱)。每个任务只跑它列出的测试加架构测试。
- **验证口径(如实):** 写计划时,**服务端部分(S1–S4)的全部代码与测试在一份 `server/` 的临时副本里真实运行过**:新增 3 个测试文件加契约共 ~90 个用例全绿,既有 `test_wordbook_definitions_build.py` 与数据测试仍绿;全量 `pytest` 一次在 `test_agents_privacy.py::test_memory_worker...` 因后台任务竞争失败(单独跑两边都绿,与本计划无关),重跑其余部分无失败;`forms` 命令在真实输入 `D:\tmp-ecdict` 上跑过两次,输出逐字节相同。**网页部分(W1–W4)只读了代码、没有运行任何测试或构建**:执行者第一次运行时以真实结果为准修正(尤其 jsdom 对 `HTMLMediaElement.play`、`createObjectURL` 的行为、`Slot` 的异步渲染)。真机(iOS 朗读手势)、360 px 操作条宽度标「未验证」。
- **实测数字(2026-10-13,真实数据):** `forms.txt` 21,074 行、覆盖 11,537 个原形、361,197 字节、sha256 `a44e4cc42fb7a3563ccb844601375280debf93f29c80edb875f6e917460097b1`(执行者的结果应与此逐字节一致,不一致先查输入校验和);七本书索引冷启动合计 1.69 s(34,133 个键);短语表(≤3 词的 49,554 去重短语的超集)首次多词查询构建约 3 s(tracemalloc 下)、≈ 11 MiB。主包体积增量在 W4 实测,不预估。

## 对 spec「核对」项的裁定(读真实代码得出)

| spec 核对项 | 结论 |
|---|---|
| 限流沿用 AI 路由做法 | AI 路由用 `Depends(limited_user)`:每用户每分钟桶 `app.state.user_limiter`(默认 `ai_rate_limit_per_minute=60`,按用户覆盖 `quota_cache`),超限 429 `{"error":"Too many requests, please try again later"}`。词典路由同样 `limited_user`,**共用同一个桶**(R-L3)。 |
| 词典放哪个模块 / 路由 | `app/wordbook/{forms,lookup}.py` + `app/routers/dictionary.py`(R-L1);`main.py` 只加一个导入名和一个路由顺序(在 `stubs` 之前)。 |
| 是否受 `WORDBOOK_ENABLED` 控制 | 不受(R-L2):词典文件随镜像提供,选词查词不依赖背单词。文件缺失 = `hit:false`。 |
| `Dockerfile.dockerignore` / 校验和 / NOTICE | 见 Global Constraints:dockerignore 不用改;校验和测试 = `test_wordbook_forms_data.py`;NOTICE 改 ECDICT 一条(forms.txt 再分发了由 ECDICT `exchange` 派生的词形对)。 |
| 契约夹具 + 网页契约测试 | 仓库惯例是「服务端录制 JSON + 网页逐键核对」。新建**独立**夹具 `dictionary_contract.json`(不动 `wordbook_contract.json`,A 要重录它),网页 `dictionary-contract.test.ts`(R-L7)。 |
| 朗读如何暴露 | 新扩展点 `selectionActions`(R-L5);`lookup→chat` 不在基线,不能直接用 `useTtsPlayer`。 |
| 加入生词本 | 操作条与抽屉都渲染 `<WordActions>`(核心贡献 = `AddVocabularyAction`)。操作条用 `variant="icon"`。 |
| 查词前没有释义可存 | 选中词后(防抖 300 ms 稳定)网页**预取**一次词典(便宜、无上游成本),拿到就把中文释义放进「加入」按钮的 target(R-L6)。 |
| `def_lang` 在 lookup 里从哪来 | 服务端把用户的 `def_lang` 放进命中响应(同一次请求、不缓存),网页不导入 wordbook 也不另发请求(R-L4)。 |
| 英文释义缺失时的回退 | 与 spec D2 一致:有效偏好 `en` 而 `defs_en` 为空 → 显示中文(纯函数 `visibleDefs`,单测)。 |
| 离线 / 出错 | 词典请求失败(任何错误、8 s 超时)→ 静默回退大模型路径;大模型错误经 `translateServerError`。 |

## 本计划的裁定

- **R-L1 模块位置:** `app/wordbook/forms.py`、`app/wordbook/lookup.py`;路由 `app/routers/dictionary.py`。
- **R-L2 不受功能开关控制;** 七本书全部参与(不看 `wordbook_books`),按 `BOOK_IDS` 顺序(初中 → SAT),第一本有该词的书给词卡。
- **R-L3 限流:** `limited_user`,与 AI 共用 60/分钟/用户 的桶。预取每次选词 1 次、点「AI 讲解」另算 AI 的 1 次,正常使用远低于上限;预取被 429 时静默当未命中。
- **R-L4 响应:** `{hit, word, lemma?, phonetic?, defs_zh[{pos,text}], defs_en[{pos,text}], phrases?[{en,zh}], source:"dict", def_lang}`;`hit=false` 只回 `{"hit": false}`。`word`:直接命中 = 词书里的写法(`Monday`);变形 = 规范化后的查询(`went`)并带 `lemma`(`go`)。中文释义最多 4 条、短语最多 3 条、英文释义沿用加载器的 ≤2/词性、≤4 总数。短语命中:`defs_zh=[{pos:"",text:译文}]`、`defs_en=[]`、无 `phrases`。
- **R-L5 朗读扩展点:** `PointProps.selectionActions = { text: string; testId: string }`;chat 在 `register-selection-actions.tsx` 登记核心贡献 `selectionActions/chat.read-aloud`(无联动键,永远可见)。组件在**点击处理函数里同步**调用 `tts.play`(其同步段先 `primeAudioElement`,再 await 合成),配置在挂载时预载,载入前按钮禁用,TTS 未配置则不渲染。
- **R-L6 预取:** 仅单词 / 短语选区(`classifySelection === "lookup"`);只在组件状态里持有,不跨选区缓存、不写 IndexedDB(词典结果带用户偏好 `def_lang`,不能长期缓存)。同一词的飞行中请求去重。
- **R-L7 契约夹具独立。**
- **R-L8 词形表规则(脚本里写死、测试钉住):** 只收七本书的原形;形式来自 ECDICT `exchange` 的 `p d i 3 s r t`(原形行)与 `0:`(变形行指回原形);形式本身是词书词头的不收(直接命中先于它);形式须是单个小写 token(`^[a-z]+(?:['\-][a-z]+)*$`);多个原形争同一形式 → 取 ECDICT `frq` 最小的已知值(未知排后),再按字母序。**不做**规则式词形还原(`textnorm.lemma_candidates`)兜底,也不做所有格以外的任何猜测(后续可加,需要单独实测误判率)。
- **R-L9 所有格:** 先按原样查,再去掉 `'s` 查一次。
- **R-L10 AI 讲解按钮:** 只在词典命中时出现;结果显示在词典结果下方;换词 / 切换模式 / 关抽屉都会中止并清空。

## 文件结构与共享文件风险

```
server/
  scripts/wordbook_definitions.py          [改] forms 命令(S1);独占(A、C 不碰)
  app/wordbook/forms.py                    新(S3)
  app/wordbook/lookup.py                   新(S3)
  app/routers/dictionary.py                新(S4)
  app/main.py                              [共享·两处单行] import 名 + 路由顺序(S4)
  dictionaries/wordbook-definitions/forms.txt、SOURCE.json   数据提交(S2)
  tests/test_wordbook_forms_build.py、test_wordbook_forms_data.py、test_dictionary_lookup.py、test_dictionary_api.py、test_dictionary_contract.py   新
  tests/fixtures/dictionary_contract.json  新(S4 录制)
NOTICE                                     [共享] ECDICT 一条(S2)
server/app/wordbook/CLAUDE.md              [共享·A 会在 Pitfalls 的 Contract fixture 行后加一行] 我只在 What lives here 的 recall.py 之后加两行、Pitfalls 末尾加一行
server/dictionaries/CLAUDE.md、wordbook-definitions/CLAUDE.md、server/scripts/CLAUDE.md、server/tests/CLAUDE.md、server/app/routers/CLAUDE.md   [改]
web/src/
  lib/extension-points.ts                  [改] selectionActions(W1)
  lib/extension-points.test.tsx、plugins/links-matrix.test.tsx   [改] 点列表 / 核心贡献列表(W1)
  plugins/core.ts、plugins/CLAUDE.md、lib/CLAUDE.md   [改](W1)
  features/chat/{read-aloud-action,register-selection-actions}.tsx + 测试、chat/CLAUDE.md   新 / 改(W1)
  features/lookup/{dictionary.ts,use-dictionary-prefetch.ts,dictionary-result.tsx,lookup-bar.tsx} + 测试   新(W2、W3)
  features/lookup/{lookup-layer.tsx,lookup-layer.test.tsx,i18n/*.json,CLAUDE.md}   [改](W3)
  e2e/lookup.spec.ts、e2e/vocabulary.spec.ts   [改,不运行](W4)
  README.md(web)                           [共享·A 也会改] 只在「查词」一节追加一段(W4)
```

共享文件风险:(1) `main.py` 两处单行,别人若也加路由会文本冲突,按字母位置手工合并;(2) `NOTICE`、各 `CLAUDE.md`、`web/README.md` 与 A 的追加相邻,合并时保留双方;(3) 操作条是 `layout/app-shell.tsx` 里 `absolute` 定位的子元素,C 改 `html/body` 固定与 `--app-height` 后需目视确认操作条仍贴底(未验证);(4) `lib/extension-points.ts` 无其他计划触碰。A 把 `DEFAULT_DEF_LANG` 改为 `"en"` 后,我的夹具里的 `"def_lang"` 值会从 `"both"` 变 `"en"`:契约测试只比形状,合并 A 后可重录一次(可选)。

---

# 服务端

## Task S1:`forms` 命令(脚本)

**Files:** Modify `server/scripts/wordbook_definitions.py`;Create `server/tests/test_wordbook_forms_build.py`。

- [ ] **Step 1:** 在 `wordbook_definitions.py` 做下面 8 处修改(Edit,锚点是现有文本)。

1. 模块文档串里 `check` 那行之后加一行:
```
  uv run python scripts/wordbook_definitions.py forms   --sources D:\\tmp-ecdict   # forms.txt: inflected form -> lemma
```
2. `FILES` 末项改为 `"missing": "missing.txt", "manifest": "SOURCE.json", "forms": "forms.txt"}`。
3. `ECDICT_DB_BYTES = 851_288_064` 之后加:
```python
FORMS_VERSION = 1           # forms.txt rules (not SCRIPT_VERSION: definitions.jsonl bytes do not depend on them)
FORM_KINDS = ("p", "d", "i", "3", "s", "r", "t")  # ECDICT exchange kinds that name an inflected form of the lemma
FORM_RE = re.compile(r"^[a-z]+(?:['\-][a-z]+)*$")  # one lower-case token: letters with inner ' or -
```
4. 在 `# ---------------------------------------------------------------- extras (hand / llm)` 这一行**之前**插入:
```python
# ---------------------------------------------------------------- forms.txt (inflected form -> lemma)

def parse_exchange_pairs(exchange: str | None) -> dict[str, list[str]]:
    """'p:went/d:gone/0:go' -> {'p': ['went'], 'd': ['gone'], '0': ['go']}: values lower-cased, empty ones dropped."""
    out: dict[str, list[str]] = {}
    for item in (exchange or "").split("/"):
        kind, _, value = item.partition(":")
        value = value.strip().lower()
        if kind and value:
            out.setdefault(kind, []).append(value)
    return out


@dataclass
class FormsScan:
    candidates: dict[str, set[str]] = field(default_factory=dict)  # form -> the lemmas that claim it
    frq: dict[str, int] = field(default_factory=dict)              # lemma -> ECDICT frequency rank (smaller = commoner, 0 = unknown)


def scan_ecdict_forms(db_path: Path, lemmas: set[str]) -> FormsScan:
    """One pass over ECDICT. A form is claimed by a word-book lemma either from the lemma's own row (`p:went/d:gone/...`)
    or from the form's row (`0:go`). Only lemmas in `lemmas` count; nothing else of ECDICT is kept."""
    scan = FormsScan()
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        for word, exchange, frq in con.execute("select word, exchange, frq from stardict order by rowid"):
            low = (word or "").lower()
            if low in lemmas and (low not in scan.frq or word == low):  # the exact lower-case row wins
                scan.frq[low] = int(frq or 0)
            if not exchange:
                continue
            pairs = parse_exchange_pairs(exchange)
            if low in lemmas:
                for kind in FORM_KINDS:
                    for form in pairs.get(kind, ()):
                        scan.candidates.setdefault(form, set()).add(low)
            for lemma in pairs.get("0", ()):
                if lemma in lemmas:
                    scan.candidates.setdefault(low, set()).add(lemma)
    finally:
        con.close()
    return scan


def build_forms(scan: FormsScan, lemmas: set[str]) -> dict[str, str]:
    """form -> lemma. A form that is itself a word-book headword is left out (the headword lookup finds it first);
    a form several lemmas claim goes to the commonest one (smallest known ECDICT `frq`, unknown last, then alphabetical)."""
    table: dict[str, str] = {}
    for form, claimed in scan.candidates.items():
        claimed = claimed - {form}
        if not claimed or form in lemmas or not FORM_RE.match(form):
            continue
        table[form] = min(claimed, key=lambda lemma: (scan.frq.get(lemma, 0) <= 0, scan.frq.get(lemma, 0), lemma))
    return table


def render_forms(table: dict[str, str]) -> bytes:
    return "".join(f"{form}\t{table[form]}\n" for form in sorted(table)).encode("utf-8")


def forms_problems(path: Path) -> list[str]:
    """Schema rules the runtime loader (`app/wordbook/forms.py`) relies on: `form<TAB>lemma`, sorted, no duplicates."""
    if not path.is_file():
        return [f"{path.name}: missing"]
    problems, previous = [], ""
    for number, line in enumerate(path.read_bytes().decode("utf-8").split("\n"), 1):
        if not line:
            continue
        form, tab, lemma = line.partition("\t")
        if not tab or "\t" in lemma or not FORM_RE.match(form) or not lemma or lemma != lemma.strip().lower() or form == lemma:
            problems.append(f"line {number}: bad row")
        elif form <= previous:
            problems.append(f"line {number}: not sorted ({form})")
        else:
            previous = form
    return problems


```
5. 在 `build()` 里,把
```python
    manifest = build_manifest(data_dir, result, day, books_sha)
    write_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return result
```
替换为
```python
    manifest = build_manifest(data_dir, result, day, books_sha)
    if "forms" in previous and (data_dir / FILES["forms"]).is_file():  # the `forms` command owns this part: carry it over
        manifest["files"].append(_file_entry(data_dir / FILES["forms"], entries=_line_count(data_dir / FILES["forms"])))
        manifest["forms"] = previous["forms"]
    write_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return result


def forms_rules() -> dict:
    return {"version": FORMS_VERSION, "kinds": list(FORM_KINDS), "lemmas": "word-book headwords only",
            "skips_book_headword_forms": True, "tiebreak": "commonest lemma by ECDICT frq, then alphabetical"}


def build_forms_file(sources: Path | None, data_dir: Path = DATA_DIR, books_dir: Path = BOOKS_DIR, *,
                     work: Path | None = None, ecdict_path: Path | None = None) -> dict:
    """Write forms.txt and add its entry to SOURCE.json (which `build` must have written before). Deterministic."""
    if ecdict_path is None:
        if sources is None:
            raise SystemExit("ecdict not found; pass --sources or set WORDBOOK_DEFS_SOURCES")
        ecdict_path = ecdict_db(sources, work or Path(tempfile.gettempdir()) / "wordbook-defs-work")
    lemmas = set(collect_wanted(books_dir)[0])
    table = build_forms(scan_ecdict_forms(ecdict_path, lemmas), lemmas)
    path = data_dir / FILES["forms"]
    write_bytes(path, render_forms(table))
    manifest_path = data_dir / FILES["manifest"]
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stats = {"forms": len(table), "lemmas_covered": len(set(table.values()))}
    manifest["files"] = [f for f in manifest["files"] if f["file"] != FILES["forms"]] + [_file_entry(path, entries=len(table))]
    manifest["forms"] = {**forms_rules(), **stats}
    write_bytes(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return stats
```
6. `check()` 里 `problems += definitions_problems(...)` 之后、`return problems` 之前加:
```python
    if any(f["file"] == FILES["forms"] for f in manifest["files"]):
        problems += forms_problems(data_dir / FILES["forms"])
```
7. `choices=("verify", "build", "check", "llm-fill")` 改为 `("verify", "build", "check", "forms", "llm-fill")`。
8. `main()` 里 `build` 分支的 `return 0` 之后、`else:` 之前加:
```python
    elif args.command == "forms":
        if sources is None:
            raise SystemExit("pass --sources or set WORDBOOK_DEFS_SOURCES")
        if problems := verify(sources):
            print("\n".join(problems))
            return 1
        print(json.dumps(build_forms_file(sources, args.data_dir, args.books_dir, work=args.work), indent=2))
        return 0
```

- [ ] **Step 2:** Create `server/tests/test_wordbook_forms_build.py`:

```python
"""The `forms` command of scripts/wordbook_definitions.py (spec 2026-10-13-defs-default-lookup-ios §3.2): the inflected
form -> lemma table built from ECDICT `exchange` data. Fixtures only, no real sources."""
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

from tests.test_wordbook_definitions_build import make_books, make_ecdict, make_wordnet_zip, run_build

SERVER = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("wordbook_definitions", SERVER / "scripts" / "wordbook_definitions.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # @dataclass looks the module up by name
    spec.loader.exec_module(module)
    return module


wd = _load()

ECDICT_ROWS = [
    ("go", "p:went/d:gone/i:going/3:goes/s:goes", 35), ("went", "0:go/1:p", 0), ("gone", "0:go/1:d", 0),
    ("leaf", "s:leaves/p:leafed", 1559), ("leave", "3:leaves/p:left/d:left/i:leaving", 300), ("leaves", "0:leave/1:3", 0),
    ("axe", "s:axes", 11388), ("axis", "s:axes", 5598),
    ("run", "p:ran/i:running", 100), ("running", "0:run/1:i", 0),
    ("dog", "s:dogs", 900), ("dogs", "0:dog/1:s", 0),
    ("big", "r:bigger/t:biggest/f:bigness", 800),
    ("hello", "s:Hello's/p:hel lo/d:HELLOED/i:", 0), ("Hello", "s:hellos", 0),
    ("zebra", "s:zebras", 50),
]
BOOK_WORDS = ("go", "leaf", "leave", "axe", "axis", "run", "running", "dog", "dogs", "big", "hello", "Child", "ice cream")


def make_forms_ecdict(path: Path) -> Path:
    con = sqlite3.connect(path)
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)", ECDICT_ROWS + [("ice cream", "s:ice creams", 0)])
    con.commit()
    con.close()
    return path


def write_books(folder: Path, words=BOOK_WORDS) -> Path:
    folder.mkdir(exist_ok=True)
    for book in wd.BOOK_IDS:
        rows = [{"word": w, "translations": [{"translation": "x", "type": "n"}], "phrases": [], "sentences": []}
                for w in (words if book == "junior" else ())]
        (folder / f"{book}.jsonl").write_bytes("".join(json.dumps(r) + "\n" for r in rows).encode("utf-8"))
    return folder


def table_of(tmp_path: Path) -> dict[str, str]:
    books = write_books(tmp_path / "books")
    lemmas = set(wd.collect_wanted(books)[0])
    return wd.build_forms(wd.scan_ecdict_forms(make_forms_ecdict(tmp_path / "stardict.db"), lemmas), lemmas)


@pytest.mark.parametrize("exchange, pairs", [
    ("p:went/d:gone/0:go", {"p": ["went"], "d": ["gone"], "0": ["go"]}), ("", {}), (None, {}), ("s:", {}),
    ("p:Went/p:WENT", {"p": ["went", "went"]}), ("garbage/1:p", {"1": ["p"]}), (":x", {}),
])
def test_parse_exchange_pairs(exchange, pairs):
    assert wd.parse_exchange_pairs(exchange) == pairs


def test_the_table_has_forms_from_the_lemma_row_and_from_the_form_row(tmp_path):
    table = table_of(tmp_path)
    assert table["went"] == "go" and table["gone"] == "go" and table["going"] == "go" and table["goes"] == "go"
    assert table["bigger"] == "big" and table["biggest"] == "big"  # r / t kinds; the f kind (bigness) is not an inflection
    assert "bigness" not in table and table["leafed"] == "leaf" and table["left"] == "leave"
    assert "ice creams" not in table  # a form with a space is not a single token


def test_a_form_claimed_by_several_lemmas_goes_to_the_commonest_one(tmp_path):
    table = table_of(tmp_path)
    assert table["leaves"] == "leave"  # leaf 1559 vs leave 300: the smaller rank wins
    assert table["axes"] == "axis"  # axis 5598 vs axe 11388


def test_the_tiebreak_prefers_a_known_rank_then_the_alphabet():
    scan = wd.FormsScan(candidates={"x": {"b", "a"}, "y": {"b", "a"}, "z": {"b", "a"}}, frq={"b": 5, "a": 0})
    assert wd.build_forms(scan, {"a", "b"}) == {"x": "b", "y": "b", "z": "b"}
    assert wd.build_forms(wd.FormsScan(candidates={"x": {"b", "a"}}, frq={}), {"a", "b"}) == {"x": "a"}
    assert wd.build_forms(wd.FormsScan(candidates={"x": {"b", "a"}}, frq={"a": 9, "b": 9}), {"a", "b"}) == {"x": "a"}


def test_forms_that_are_headwords_themselves_are_left_out(tmp_path):
    table = table_of(tmp_path)
    assert "running" not in table and "dogs" not in table  # both are word-book headwords: the headword lookup finds them
    assert "go" not in table and table["ran"] == "run"


def test_only_book_lemmas_count_and_bad_shaped_forms_are_dropped(tmp_path):
    table = table_of(tmp_path)
    assert "zebras" not in table  # zebra is not in the books
    assert table["hello's"] == "hello" and table["helloed"] == "hello" and table["hellos"] == "hello"
    assert "hel lo" not in table and "" not in table
    assert all(wd.FORM_RE.match(form) and form != lemma for form, lemma in table.items())


def test_the_exact_lowercase_row_supplies_the_rank(tmp_path):
    books = write_books(tmp_path / "books", ("hello", "world"))
    con = sqlite3.connect(tmp_path / "rank.db")
    con.execute("create table stardict (id integer primary key, word text, exchange text, frq integer)")
    con.executemany("insert into stardict (word, exchange, frq) values (?, ?, ?)",
                    [("Hello", "s:xa", 7), ("hello", "s:xb", 9), ("world", "s:xb", 3)])
    con.commit()
    con.close()
    lemmas = set(wd.collect_wanted(books)[0])
    scan = wd.scan_ecdict_forms(tmp_path / "rank.db", lemmas)
    assert scan.frq["hello"] == 9  # the capitalised row came first (7); the exact lower-case row wins
    assert wd.build_forms(scan, lemmas)["xb"] == "world"  # world (3) is commoner than hello (9)


def test_render_is_sorted_tab_separated_lf_and_byte_stable(tmp_path):
    table = table_of(tmp_path)
    data = wd.render_forms(table)
    lines = data.decode("utf-8").split("\n")
    assert lines[-1] == "" and b"\r" not in data
    forms = [line.split("\t")[0] for line in lines[:-1]]
    assert forms == sorted(forms) and len(set(forms)) == len(forms) and all(line.count("\t") == 1 for line in lines[:-1])
    again = tmp_path / "again"
    again.mkdir()
    assert wd.render_forms(table_of(again)) == data


def test_forms_problems_catches_schema_violations(tmp_path):
    path = tmp_path / "forms.txt"
    assert wd.forms_problems(path) == ["forms.txt: missing"]
    path.write_bytes(b"stopped\tstop\nwent\tgo\n")
    assert wd.forms_problems(path) == []
    path.write_bytes(b"stopped\tstop\nbad row\nUpper\tgo\nsame\tsame\nempty\t\ntabs\tStop\nstopped\tstop\nzed\ta\tb\naaa\tgo\n")
    assert wd.forms_problems(path) == [
        "line 2: bad row", "line 3: bad row", "line 4: bad row", "line 5: bad row", "line 6: bad row",
        "line 7: not sorted (stopped)", "line 8: bad row", "line 9: not sorted (aaa)"]


# ---- the command: file + manifest ----

def build_env(tmp_path):
    return {"zip": make_wordnet_zip(tmp_path / "wn.zip"), "db": make_ecdict(tmp_path / "stardict.db"),
            "books": make_books(tmp_path / "books"), "out": tmp_path / "out"}


def test_the_command_writes_the_file_and_adds_it_to_the_manifest(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    stats = wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    assert stats == {"forms": 4, "lemmas_covered": 4}
    # children is a headword (left out); the fixture rows also say the -> thes, in -> ins, `Child` -> p:x, abandoned -> abandon
    assert (env["out"] / "forms.txt").read_bytes() == b"abandoned\tabandon\nins\tin\nthes\tthe\nx\tchild\n"
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    entry = manifest["files"][-1]
    assert entry["file"] == "forms.txt" and entry["entries"] == 4 and entry["sha256"] == wd.sha256_of(env["out"] / "forms.txt")
    assert manifest["forms"] == {**wd.forms_rules(), "forms": 4, "lemmas_covered": 4}
    assert manifest["forms"]["version"] == wd.FORMS_VERSION and manifest["forms"]["kinds"] == list(wd.FORM_KINDS)
    assert wd.check(env["out"]) == []


def test_check_catches_a_tampered_forms_file(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    path = env["out"] / "forms.txt"
    path.write_bytes(b"x\tchild\nabandoned\tabandon\nins\tin\nthes\tthe\n")  # same size, different bytes (and unsorted)
    assert "forms.txt: sha256 mismatch" in wd.check(env["out"])
    path.write_bytes(b"x\tchild\n")
    assert any(p.startswith("forms.txt: size") for p in wd.check(env["out"]))


def test_the_command_is_byte_identical_across_runs_and_a_rebuild_keeps_it(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    first = {p.name: p.read_bytes() for p in env["out"].iterdir()}
    wd.build_forms_file(None, env["out"], env["books"], ecdict_path=env["db"])
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    run_build(env)  # `build` rewrites SOURCE.json: the forms entry and block must survive, byte for byte
    assert {p.name: p.read_bytes() for p in env["out"].iterdir()} == first
    assert wd.check(env["out"]) == []


def test_build_without_forms_does_not_invent_a_manifest_entry(tmp_path):
    env = build_env(tmp_path)
    run_build(env)
    manifest = json.loads((env["out"] / "SOURCE.json").read_text(encoding="utf-8"))
    assert "forms" not in manifest and all(f["file"] != "forms.txt" for f in manifest["files"])


def test_the_cli_command_needs_sources(tmp_path, monkeypatch):
    monkeypatch.delenv("WORDBOOK_DEFS_SOURCES", raising=False)
    with pytest.raises(SystemExit):
        wd.main(["forms", "--data-dir", str(tmp_path)])
    with pytest.raises(SystemExit):
        wd.build_forms_file(None, tmp_path, tmp_path)
```

- [ ] **Step 3:** `cd server && uv run pytest -q tests/test_wordbook_forms_build.py tests/test_wordbook_definitions_build.py tests/test_architecture.py` → 全绿。
- [ ] **Step 4:** 更新 `server/scripts/CLAUDE.md`:在 `wordbook_definitions.py` 那条末尾加「`forms` 子命令(ECDICT `exchange` → `forms.txt` 词形 → 原形小表,确定性;需先 `build`,因为它给 `SOURCE.json` 追加条目;`build` 会带过已有的 forms 条目)」;Tests 行加 `tests/test_wordbook_forms_build.py`。
- [ ] **Step 5: 提交** `feat(server): add the forms command to the wordbook definitions builder`。

## Task S2:生成并提交词形表(独占数据提交)

**Files:** Create `server/dictionaries/wordbook-definitions/forms.txt`;Modify `…/SOURCE.json`(脚本写)、`NOTICE`、`server/dictionaries/wordbook-definitions/CLAUDE.md`、`server/dictionaries/CLAUDE.md`;Create `server/tests/test_wordbook_forms_data.py`。

- [ ] **Step 1:** 输入目录是不可信数据:在 `server/` 下、不同于输入目录的位置运行(`python -I` 由 `uv run` 负责,至少不要 cd 进 `D:\tmp-ecdict`):
```
cd server
uv run python scripts/wordbook_definitions.py forms --sources D:\tmp-ecdict
uv run python scripts/wordbook_definitions.py check
```
预期输出 `{"forms": 21074, "lemmas_covered": 11537}` 与 `ok`;`forms.txt` 361,197 字节、sha256 `a44e4cc4…097b1`。再跑一次 `forms`,`git diff` 应为空(确定性)。(该命令会先对两个输入 zip 做 sha256 校验,约 20 秒。)
- [ ] **Step 2:** `NOTICE` 里把
`ECDICT 1.0.28 (used only while building definitions.jsonl: word forms and frequency ranks; no ECDICT entry is redistributed)` 替换为两行:
```
ECDICT 1.0.28 (used while building definitions.jsonl and forms.txt: word forms and frequency ranks. forms.txt redistributes inflected-form -> lemma
  pairs derived from the ECDICT `exchange` field, for the word-book headwords only; no ECDICT entry text is redistributed)
```
版权行与 MIT 全文不动(`test_wordbook_definitions_data.py` 逐字断言)。
- [ ] **Step 3:** Create `server/tests/test_wordbook_forms_data.py`:

```python
"""The committed word-form table forms.txt (spec 2026-10-13-defs-default-lookup-ios §3.2): checksums, schema, coverage,
wiring, and the real files answering real lookups. The ECDICT input it was built from is not in the repo, so rebuilding
is a manual step (server/scripts/CLAUDE.md)."""
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

from app.wordbook.forms import FILE_NAME, Forms
from app.wordbook.index import DictionaryStore
from app.wordbook.lookup import DictionaryLookup

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
def pairs() -> dict[str, str]:
    rows = (DATA / FILE_NAME).read_bytes().decode("utf-8").split("\n")
    return dict(line.split("\t") for line in rows if line)


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads((DATA / "SOURCE.json").read_text(encoding="utf-8"))


def test_the_manifest_lists_the_file_and_the_checks_pass(manifest):
    assert wd.check(DATA) == []
    entry = next(f for f in manifest["files"] if f["file"] == "forms.txt")
    assert entry["sha256"] == wd.sha256_of(DATA / "forms.txt") and entry["bytes"] == (DATA / "forms.txt").stat().st_size
    assert entry["entries"] == manifest["forms"]["forms"] and manifest["files"][-1] is entry
    assert manifest["forms"]["version"] == wd.FORMS_VERSION and manifest["forms"]["kinds"] == list(wd.FORM_KINDS)
    assert manifest["forms"]["skips_book_headword_forms"] is True


def test_the_size_stays_small(manifest):
    entry = next(f for f in manifest["files"] if f["file"] == "forms.txt")
    assert 18_000 <= entry["entries"] <= 24_000  # measured 21,074 forms for 11,537 lemmas on 2026-10-13
    assert entry["bytes"] < 1024 * 1024  # measured 361,197


def test_every_lemma_is_a_book_headword_and_no_form_is(pairs):
    wanted, _ = wd.collect_wanted(BOOKS)
    assert set(pairs.values()) <= set(wanted)
    assert not set(pairs) & set(wanted)
    assert len(set(pairs.values())) >= 10_000  # most of the 14.6k headwords have at least one form


@pytest.mark.parametrize("form, lemma", [
    ("went", "go"), ("children", "child"), ("stopped", "stop"), ("studies", "study"), ("ran", "run"), ("geese", "goose"),
    ("does", "do"), ("said", "say"), ("dogs", "dog"), ("fastest", "fast"), ("leaves", "leave"), ("axes", "axis"),
])
def test_known_pairs(pairs, form, lemma):
    assert pairs[form] == lemma


def test_headword_forms_are_not_in_the_table(pairs):
    assert not {"running", "left", "better", "saw"} & set(pairs)  # each is a word-book headword: found directly


def test_the_runtime_loader_reads_the_committed_file(pairs):
    forms = Forms(DATA / FILE_NAME)
    assert len(forms) == len(pairs) and forms.lemma_of("went") == "go" and forms.lemma_of("zebraxyz") is None


async def test_real_files_answer_real_lookups():
    lookup = DictionaryLookup(DictionaryStore(BOOKS))
    went = await lookup.lookup("Went")
    assert went["word"] == "went" and went["lemma"] == "go" and went["source"] == "dict" and went["defs_zh"] and went["defs_en"]
    assert (await lookup.lookup("children"))["lemma"] == "child"
    direct = await lookup.lookup("country")
    assert direct["word"].lower() == "country" and "lemma" not in direct and direct["defs_zh"] and direct["defs_en"]
    assert await lookup.lookup("zebraxyz") is None and await lookup.lookup("ask not what your country can do") is None
    phrase = await lookup.lookup("look up")
    assert phrase is not None and phrase["defs_zh"]


def test_the_file_is_lf_without_bom():
    raw = (DATA / "forms.txt").read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r" not in raw and raw.endswith(b"\n")
    raw.decode("utf-8")


def test_notice_gitattributes_and_docker_wiring():
    notice = (ROOT / "NOTICE").read_text(encoding="utf-8")
    assert "forms.txt" in notice and "skywind3000" in notice and "Permission is hereby granted" in notice
    attrs = (ROOT / ".gitattributes").read_text(encoding="utf-8")
    assert "server/dictionaries/wordbook-definitions/*.txt binary" in attrs  # forms.txt is checksummed: no EOL conversion
    assert "COPY server/dictionaries /app/dictionaries" in (SERVER / "Dockerfile").read_text(encoding="utf-8")
    assert "!server/dictionaries" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()


def test_no_secret_shaped_text_in_the_file():
    pattern = re.compile(r"(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|api[_-]?key\s*[:=])", re.I)
    assert not pattern.search((DATA / "forms.txt").read_text(encoding="utf-8"))
```
注意:`test_real_files_answer_real_lookups` 依赖 S3 的模块,所以**本任务在 S3 之后提交**(见 Step 5);S2 的数据文件与 S3 的代码互不依赖,但这条测试需要两者。
- [ ] **Step 4:** 文档:`server/dictionaries/wordbook-definitions/CLAUDE.md` 的 What lives here 加 `- forms.txt – GENERATED by scripts/wordbook_definitions.py forms: form<TAB>lemma, sorted, LF (21,074 rows, 361,197 bytes); inflected forms of word-book headwords from ECDICT exchange (rules R-L8: skips forms that are headwords themselves; commonest lemma wins); read by app/wordbook/forms.py`;Test 行加 `tests/test_wordbook_forms_data.py tests/test_wordbook_forms_build.py`;Rules 加「`build` 带过 `forms` 条目;重生 `forms.txt` 单独提交」。`server/dictionaries/CLAUDE.md` 的 `wordbook-definitions/` 条加「+ forms.txt」,Test 行同样加一个文件。
- [ ] **Step 5:** 先完成 S3,再 `cd server && uv run pytest -q tests/test_wordbook_forms_data.py tests/test_wordbook_definitions_data.py tests/test_wordbook_function_words.py`,然后**单独提交数据**:`git add server/dictionaries/wordbook-definitions/forms.txt server/dictionaries/wordbook-definitions/SOURCE.json` → `chore(server): add wordbook word-form table (ECDICT exchange)`;`NOTICE`、CLAUDE.md、测试另提交 `test(server): pin the word-form table data and notice`。

## Task S3:加载器与查询编排

**Files:** Create `server/app/wordbook/forms.py`、`server/app/wordbook/lookup.py`、`server/tests/test_dictionary_lookup.py`;Modify `server/app/wordbook/CLAUDE.md`。

- [ ] **Step 1:** Create `server/app/wordbook/forms.py`:

```python
"""词形 -> 原形小表(spec 2026-10-13-defs-default-lookup-ios §3.2):`wordbook-definitions/forms.txt`,每行 `形式<TAB>原形`,
按形式排序,由 `server/scripts/wordbook_definitions.py forms` 离线生成(只含七本书里出现的原形的变形)。

运行时只读;文件缺失或损坏 = 没有词形还原,查词照常(静默降级)。不发网络请求,不调用 LLM,不记录词(日志只有行数)。
文件被换掉(大小或修改时间变了)时下一次查询重新读取。纯标准库。"""
import asyncio
import logging
import threading
from pathlib import Path

from app.wordbook.definitions import DIR_NAME

logger = logging.getLogger(__name__)

FILE_NAME = "forms.txt"


def default_path(book_data_dir: Path) -> Path:
    """与英文释义同目录:`<dictionaries>/wordbook-definitions/forms.txt`(容器里 /app/dictionaries/...)。"""
    return Path(book_data_dir).parent / DIR_NAME / FILE_NAME


class Forms:
    """懒加载的 形式 -> 原形。第一次查询(或 `warm`)读一次文件;线程安全。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, str] | None = None
        self._stamp: tuple[int, int] | None = None

    def _stamp_now(self) -> tuple[int, int] | None:
        try:
            stat = self.path.stat()
        except OSError:
            return None
        return stat.st_size, stat.st_mtime_ns

    def _load(self) -> dict[str, str]:
        data: dict[str, str] = {}
        bad = 0
        try:
            with self.path.open("rb") as handle:
                for raw in handle:
                    if not raw.strip():
                        continue
                    form, tab, lemma = raw.decode("utf-8", "replace").rstrip("\r\n").partition("\t")
                    if tab and form and lemma and "\t" not in lemma:
                        data[form] = lemma
                    else:
                        bad += 1
        except OSError:
            logger.info("wordbook forms file unavailable")
            return {}
        if bad:
            logger.warning("wordbook forms skipped lines=%d", bad)
        return data

    def _ensure(self) -> dict[str, str]:
        stamp = self._stamp_now()
        data = self._data
        if data is None or stamp != self._stamp:
            with self._lock:
                if self._data is None or stamp != self._stamp:
                    self._data, self._stamp = self._load(), stamp
                data = self._data
        return data

    async def warm(self) -> None:
        """在事件循环之外先读一次(几百 KB),之后的 `lemma_of` 不再阻塞。文件变了也在这里重读。"""
        if self._data is None or self._stamp_now() != self._stamp:
            await asyncio.to_thread(self._ensure)

    def __len__(self) -> int:
        return len(self._ensure())

    def lemma_of(self, form: str) -> str | None:
        """键是规范化小写词;没有 = None。"""
        return self._ensure().get(form)
```

- [ ] **Step 2:** Create `server/app/wordbook/lookup.py`:

```python
"""选词词典(spec 2026-10-13-defs-default-lookup-ios §3.2):规范化 -> 词书直接命中 -> 词形还原 -> 短语表精确命中。

只读七本词书(`DictionaryStore` 的索引与词卡)、英文释义和词形小表;不发网络请求、不调用 LLM、不写库、不记录查询的词
(这里没有任何日志调用)。没有英文释义 / 词形文件也能工作(对应部分为空)。属于 wordbook 层:只有 routers 导入。"""
import asyncio
import json
import re
import threading
from pathlib import Path

from app.services.vocabulary import normalize_word
from app.wordbook.books import BOOK_IDS, book_by_id
from app.wordbook.entry import WordCard, headword_key
from app.wordbook.forms import Forms, default_path
from app.wordbook.index import DataUnavailable, DictionaryStore, dictionary

MAX_WORDS = 3  # 超过 3 个词或 40 个字符的输入不查词典(网页走翻译 / 大模型)
MAX_CHARS = 40
MAX_ZH = 4  # 一次响应里的中文释义条数上限(词卡最多 6 条)
MAX_PHRASES = 3
_EDGE = re.compile(r"^\W+|\W+$")


def normalize_query(text: str) -> str | None:
    """规范化(NFC、折叠排版撇号、小写、压缩空白)并去掉首尾标点;不是查词候选(空、太长、词太多、含汉字、词头黑名单)返回 None。"""
    key = _EDGE.sub("", normalize_word(text))
    if not key or len(key) > MAX_CHARS or len(key.split()) > MAX_WORDS:
        return None
    return key if headword_key(key) is not None else None


def _variants(key: str) -> list[str]:
    """`john's` 先按原样查,再去掉所有格 's 查一次。"""
    return [key, key[:-2]] if key.endswith("'s") and len(key) > 3 else [key]


def _build_phrases(data_dir: Path) -> dict[str, str]:
    """短语(<= 3 个词)-> 中文释义,按书的顺序取第一次出现;读七个文件一遍(约 1.5 秒),在线程里调用。"""
    out: dict[str, str] = {}
    for book in BOOK_IDS:
        try:
            with (data_dir / book_by_id(book).file).open("rb") as handle:
                for line in handle:
                    if b'"phrase"' not in line:
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    phrases = row.get("phrases") if isinstance(row, dict) else None
                    for p in phrases if isinstance(phrases, list) else []:
                        if not isinstance(p, dict):
                            continue
                        key = normalize_query(str(p.get("phrase") or ""))
                        zh = " ".join(str(p.get("translation") or "").split())
                        if key and " " in key and zh:
                            out.setdefault(key, zh)
        except OSError:
            continue
    return out


class DictionaryLookup:
    def __init__(self, store: DictionaryStore):
        self.store = store
        self.forms = Forms(default_path(store.data_dir))
        self._lock = threading.Lock()
        self._phrases: dict[str, str] | None = None
        self._stamp: tuple | None = None

    async def lookup(self, text: str) -> dict | None:
        """命中返回响应体(不含 def_lang,由路由补),否则 None。"""
        key = normalize_query(text)
        if key is None:
            return None
        await self.forms.warm()
        await self.store.definitions.warm()
        for variant in _variants(key):
            card = await self._card(variant)
            if card is None and " " not in variant and (lemma := self.forms.lemma_of(variant)):
                card = await self._card(lemma)
            if card is not None and (out := self._entry(key, card)) is not None:
                return out
        return await self._phrase(key) if " " in key else None

    async def _card(self, key: str) -> WordCard | None:
        for book in BOOK_IDS:  # 初中 -> SAT:先命中的书给词卡
            try:
                if key in await self.store.index(book):
                    card = await self.store.card(book, key)
                    if card is not None:
                        return card
            except DataUnavailable:
                continue
        return None

    def _entry(self, query: str, card: WordCard) -> dict | None:
        zh = [{"pos": s.pos, "text": s.text} for s in card.senses[:MAX_ZH]]
        en = self.store.definitions.defs_for(card.key)
        if not zh and not en:
            return None
        inflected = card.key != query
        out: dict = {"hit": True, "word": query if inflected else card.word}
        if inflected:
            out["lemma"] = card.word
        if phonetic := card.us or card.uk:
            out["phonetic"] = phonetic
        out["defs_zh"], out["defs_en"] = zh, en
        if card.phrases:
            out["phrases"] = [{"en": en_text, "zh": zh_text} for en_text, zh_text in card.phrases[:MAX_PHRASES]]
        out["source"] = "dict"
        return out

    def _signature(self) -> tuple:
        stamps = []
        for book in BOOK_IDS:
            try:
                stat = (self.store.data_dir / book_by_id(book).file).stat()
            except OSError:
                stamps.append(None)
            else:
                stamps.append((stat.st_size, stat.st_mtime_ns))
        return tuple(stamps)

    def _phrase_map(self) -> dict[str, str]:
        stamp = self._signature()
        with self._lock:
            if self._phrases is None or stamp != self._stamp:
                self._phrases, self._stamp = _build_phrases(self.store.data_dir), stamp
            return self._phrases

    async def _phrase(self, key: str) -> dict | None:
        zh = (await asyncio.to_thread(self._phrase_map)).get(key)
        if zh is None:
            return None
        return {"hit": True, "word": key, "defs_zh": [{"pos": "", "text": zh}], "defs_en": [], "source": "dict"}


def lookup_service(app) -> DictionaryLookup:
    """唯一入口:跟随 `dictionary(app)` 的 store(数据目录变了就换一个新的)。"""
    store = dictionary(app)
    service = getattr(app.state, "dict_lookup", None)
    if service is None or service.store is not store:
        service = app.state.dict_lookup = DictionaryLookup(store)
    return service
```

- [ ] **Step 3:** Create `server/tests/test_dictionary_lookup.py`:

```python
"""The local dictionary behind select-to-lookup (spec 2026-10-13-defs-default-lookup-ios §3.2): query normalisation,
direct hits, inflection, phrases, misses, degraded data, hot file changes. Module-level tests; the endpoint is in
test_dictionary_api.py."""
import asyncio
import json
import logging
from pathlib import Path

import pytest

from app.wordbook import lookup as lk
from app.wordbook.forms import FILE_NAME, Forms, default_path
from app.wordbook.index import DictionaryStore
from tests.wordbook_helpers import make_data_dir, make_defs_dir

FORMS = "children\tchild\nstopped\tstop\ntalk\tgo\ntalks\ttalk\nwent\tgo\n"


def build(tmp_path: Path, forms: str | None = FORMS, defs: bool = True) -> lk.DictionaryLookup:
    """`<tmp>/dict/junior.jsonl` (the mini book), `<tmp>/wordbook-definitions/{definitions,forms}`: what the loader finds."""
    data = make_data_dir(tmp_path)
    folder = make_defs_dir(tmp_path) if defs else tmp_path / "wordbook-definitions"
    folder.mkdir(exist_ok=True)
    if forms is not None:
        (folder / FILE_NAME).write_bytes(forms.encode("utf-8"))
    return lk.DictionaryLookup(DictionaryStore(data))


# ---- normalisation ----

@pytest.mark.parametrize("raw, key", [
    ("talk", "talk"), ("  Talk!  ", "talk"), ("“talk”", "talk"), ("(TALK),", "talk"), ("don’t", "don't"),
    ("  be   able  to ", "be able to"), ("Talk about it?", "talk about it"), ("-well-", "well"), ("a-b c", "a-b c"),
])
def test_normalize_query_lowercases_folds_and_strips_edge_punctuation(raw, key):
    assert lk.normalize_query(raw) == key


@pytest.mark.parametrize("raw", [
    "", "   ", "...", "“”", "a b c d", "x" * 41, "谈话", "talk 说", "undersize d", "one two three four five",
])
def test_normalize_query_rejects_non_candidates(raw):
    assert lk.normalize_query(raw) is None


def test_the_limits_are_three_words_and_forty_characters():
    assert lk.normalize_query("a b c") == "a b c" and lk.normalize_query("a b c d") is None
    assert lk.normalize_query("x" * 40) == "x" * 40 and lk.normalize_query("x" * 41) is None


# ---- direct hits ----

async def test_direct_hit_returns_the_card_in_wire_shape(tmp_path):
    out = await build(tmp_path).lookup("talk")
    assert list(out) == ["hit", "word", "phonetic", "defs_zh", "defs_en", "phrases", "source"]
    assert out["hit"] is True and out["word"] == "talk" and out["source"] == "dict" and "lemma" not in out
    assert out["phonetic"] == "tɔk"
    assert out["defs_zh"][0] == {"pos": "v", "text": "说话；谈话"}
    assert out["defs_en"] == [{"pos": "v", "text": "speak to someone"}, {"pos": "v", "text": "have a conversation"},
                              {"pos": "n", "text": "a conversation between people"}]
    assert out["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]


async def test_the_display_form_comes_from_the_book(tmp_path):
    out = await build(tmp_path).lookup("monday")
    assert out["word"] == "Monday" and "lemma" not in out
    assert out["defs_en"] == [{"pos": "n", "text": "the day of the week after Sunday"}]
    assert "phrases" not in out


async def test_case_and_edge_punctuation_do_not_matter(tmp_path):
    lookup = build(tmp_path)
    assert await lookup.lookup("  TALK. ") == await lookup.lookup("talk")


async def test_a_phonetic_is_left_out_when_the_book_has_none(tmp_path):
    out = await build(tmp_path).lookup("used to")
    assert out["word"] == "used to" and "phonetic" not in out
    assert out["defs_zh"] == [{"pos": "v", "text": "过去常常"}]
    assert out["defs_en"] == [{"pos": "v", "text": "did something often in the past"}]


async def test_at_most_three_phrases_and_four_chinese_senses(tmp_path):
    lookup = build(tmp_path)
    card = await lookup._card("talk")
    many = type(card)(card.key, card.word, card.us, card.uk, card.senses * 4,
                      tuple((f"p{i}", f"z{i}") for i in range(8)), card.examples, card.pos_mask)
    out = lookup._entry("talk", many)
    assert len(out["defs_zh"]) == lk.MAX_ZH == 4 and len(out["phrases"]) == lk.MAX_PHRASES == 3


async def test_an_entry_without_any_definition_is_a_miss(tmp_path):
    lookup = build(tmp_path)
    card = await lookup._card("talk")
    bare = type(card)(card.key, card.word, card.us, card.uk, (), (), (), 0)
    lookup.store.definitions._data = {}  # no English definitions either
    assert lookup._entry("talk", bare) is None


# ---- inflection ----

async def test_an_inflected_form_finds_its_lemma(tmp_path):
    lookup = build(tmp_path)
    went = await lookup.lookup("Went")
    assert went["word"] == "went" and went["lemma"] == "go" and went["defs_zh"][0]["text"] == "去；走"
    assert went["defs_en"] == [{"pos": "v", "text": "move or travel to a place"}] and went["source"] == "dict"
    assert (await lookup.lookup("children"))["lemma"] == "child"
    assert (await lookup.lookup("stopped"))["lemma"] == "stop"


async def test_a_headword_beats_the_form_table(tmp_path):
    out = await build(tmp_path).lookup("talk")  # the table says talk -> go, the book has talk
    assert out["word"] == "talk" and "lemma" not in out


async def test_a_possessive_falls_back_to_the_bare_word(tmp_path):
    out = await build(tmp_path).lookup("Talk’s")
    assert out["word"] == "talk's" and out["lemma"] == "talk"


async def test_a_form_whose_lemma_is_not_in_the_books_is_a_miss(tmp_path):
    assert await build(tmp_path, forms="ghosts\tghost\n").lookup("ghosts") is None


async def test_forms_are_not_tried_for_phrases(tmp_path):
    assert await build(tmp_path, forms="went on\tgo on\n").lookup("went on") is None


# ---- phrases ----

async def test_a_phrase_hits_only_when_the_phrase_tables_have_it_exactly(tmp_path):
    lookup = build(tmp_path)
    out = await lookup.lookup("Be able to")
    assert out == {"hit": True, "word": "be able to", "defs_zh": [{"pos": "", "text": "能够"}], "defs_en": [], "source": "dict"}
    assert (await lookup.lookup("by accident"))["defs_zh"][0]["text"] == "偶然"
    assert await lookup.lookup("be able") is None and await lookup.lookup("be able to do") is None
    assert (await lookup.lookup("go on"))["defs_zh"][0]["text"] == "继续"


async def test_the_phrase_table_is_built_once_for_concurrent_lookups(tmp_path, monkeypatch):
    calls = []
    real = lk._build_phrases
    monkeypatch.setattr(lk, "_build_phrases", lambda d: calls.append(1) or real(d))
    lookup = build(tmp_path)
    results = await asyncio.gather(*(lookup.lookup("be able to") for _ in range(5)))
    assert all(r["word"] == "be able to" for r in results) and len(calls) == 1


async def test_the_phrase_table_follows_a_changed_book_file(tmp_path):
    lookup = build(tmp_path)
    assert await lookup.lookup("go on") is not None
    book = tmp_path / "dict" / "junior.jsonl"
    book.write_bytes(json.dumps({"word": "stop", "translations": [{"translation": "停", "type": "v"}],
                                 "phrases": [{"phrase": "stop by", "translation": "顺便拜访"}]}).encode() + b"\n")
    assert await lookup.lookup("go on") is None
    assert (await lookup.lookup("stop by"))["defs_zh"][0]["text"] == "顺便拜访"


# ---- misses ----

@pytest.mark.parametrize("text", ["zebra", "a b c d", "x" * 41, "谈话", "", "..."])
async def test_everything_else_is_a_miss(tmp_path, text):
    assert await build(tmp_path).lookup(text) is None


# ---- degraded data ----

async def test_without_a_forms_file_headwords_still_work(tmp_path):
    lookup = build(tmp_path, forms=None)
    assert await lookup.lookup("went") is None and (await lookup.lookup("go"))["word"] == "go"


async def test_without_definitions_the_chinese_part_still_answers(tmp_path):
    out = await build(tmp_path, defs=False).lookup("talk")
    assert out["defs_en"] == [] and out["defs_zh"]


async def test_without_any_book_everything_is_a_miss(tmp_path):
    lookup = lk.DictionaryLookup(DictionaryStore(tmp_path / "nowhere"))
    assert await lookup.lookup("talk") is None and await lookup.lookup("be able to") is None


async def test_the_first_book_that_has_the_word_gives_the_card(tmp_path):
    data = make_data_dir(tmp_path, ("junior", "senior"))
    (data / "senior.jsonl").write_bytes(json.dumps({"word": "go", "us": "x", "translations": [
        {"translation": "SENIOR", "type": "v"}]}).encode() + b"\n")
    out = await lk.DictionaryLookup(DictionaryStore(data)).lookup("go")
    assert out["defs_zh"] == [{"pos": "v", "text": "去；走"}]


# ---- the forms file ----

def test_forms_loader_reads_pairs_and_skips_bad_lines_without_naming_them(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    path = tmp_path / "wordbook-definitions" / FILE_NAME
    path.parent.mkdir()
    path.write_bytes("went\tgo\nsecretbadline\nx\t\n\ta\nfoo\tbar\tbaz\nstopped\tstop\n".encode())
    forms = Forms(path)
    assert len(forms) == 2 and forms.lemma_of("went") == "go" and forms.lemma_of("stopped") == "stop"
    assert forms.lemma_of("secretbadline") is None and forms.lemma_of("Went") is None
    assert "skipped lines=4" in caplog.text and "secretbadline" not in caplog.text and "went" not in caplog.text


def test_forms_loader_missing_file_is_empty_and_default_path_is_a_sibling(tmp_path):
    assert len(Forms(tmp_path / "none.txt")) == 0 and Forms(tmp_path / "none.txt").lemma_of("went") is None
    assert default_path(tmp_path / "dictionaries" / "kylebing-english-vocabulary") == (
        tmp_path / "dictionaries" / "wordbook-definitions" / FILE_NAME)


async def test_forms_reload_when_the_file_changes(tmp_path):
    lookup = build(tmp_path, forms="went\tgo\n")
    assert await lookup.lookup("stopped") is None
    (tmp_path / "wordbook-definitions" / FILE_NAME).write_bytes(b"stopped\tstop\nwent\tgo\n")
    assert (await lookup.lookup("stopped"))["lemma"] == "stop"


def test_the_service_follows_the_data_directory(app, tmp_path):
    first = lk.lookup_service(app)
    assert lk.lookup_service(app) is first
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(make_data_dir(tmp_path))})
    second = lk.lookup_service(app)
    assert second is not first and lk.lookup_service(app) is second


def test_the_module_is_not_a_logging_site():
    source = (Path(lk.__file__)).read_text(encoding="utf-8")
    assert "logging" not in source and "logger" not in source
```

- [ ] **Step 4:** `server/app/wordbook/CLAUDE.md`:What lives here 在 `recall.py` 条之后加
`- forms.py – 词形 → 原形小表加载器(forms.txt,懒加载、文件变了自动重读)` 与 `- lookup.py – 选词词典(DictionaryLookup:规范化 → 七本书直接命中 → 词形 → 短语表;不记录查询)`;Pitfalls 末尾加一行:「选词词典 `POST /api/dictionary/lookup` 的词只在 POST 体;`lookup.py` / `forms.py` 里不许有 logging 调用(`test_dictionary_lookup.py::test_the_module_is_not_a_logging_site`);不受 `WORDBOOK_ENABLED` 控制;`DictionaryLookup` 随 `dictionary(app)` 的 store 更换(`lookup_service`)」。
- [ ] **Step 5:** `cd server && uv run pytest -q tests/test_dictionary_lookup.py tests/test_architecture.py tests/test_wordbook_definitions.py tests/test_wordbook_index.py` → 全绿。
- [ ] **Step 6: 提交** `feat(server): add the local dictionary lookup (forms table loader + lookup orchestration)`;然后回到 S2 Step 5 提交数据与数据测试。

## Task S4:路由、接线、契约夹具、隐私测试

**Files:** Create `server/app/routers/dictionary.py`、`server/tests/test_dictionary_api.py`、`server/tests/test_dictionary_contract.py`、`server/tests/fixtures/dictionary_contract.json`;Modify `server/app/main.py`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`、`server/CLAUDE.md`、`server/README.md`。

- [ ] **Step 1:** Create `server/app/routers/dictionary.py`:

```python
"""本地词典查询(spec 2026-10-13-defs-default-lookup-ios §3.2):`POST /api/dictionary/lookup`。

单词只在请求体里,不进 URL、不进日志(这里与 app/wordbook/lookup.py 都没有日志调用,校验错误也只回字段名)。
需要登录;限流与 AI 路由共用每用户每分钟桶(`limited_user`,管理端的 `ai_rate_limit_per_minute` 与按用户覆盖同样适用)。
不受 WORDBOOK_ENABLED 控制:词典文件随镜像提供,选词查词不依赖背单词功能。无迁移、不写库。
命中返回 `{hit: true, word, lemma?, phonetic?, defs_zh, defs_en, phrases?, source: "dict", def_lang}`,未命中只回 `{hit: false}`。"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session, limited_user
from app.models import User
from app.wordbook import service
from app.wordbook.lookup import lookup_service

router = APIRouter(prefix="/api/dictionary")


class LookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1000)  # 网页最多发 1000 个字符;太长的由 lookup 直接判未命中


@router.post("/lookup")
async def dictionary_lookup(payload: LookupIn, request: Request, user: User = Depends(limited_user),
                            session: AsyncSession = Depends(get_session)):
    found = await lookup_service(request.app).lookup(payload.text)
    if found is None:
        return {"hit": False}
    return {**found, "def_lang": await service.def_lang_of(session, user.id)}
```

- [ ] **Step 2:** `server/app/main.py` 两处单点修改:导入列表里 `conversations, grammar,` → `conversations, dictionary, grammar,`;路由元组里 `rooms_summary, wordbook,` 之后换行加 `        dictionary,  # /api/dictionary/*: before stubs (catch-all writes)`(在 `links,` 之前)。
- [ ] **Step 3:** Create `server/tests/test_dictionary_api.py`:

```python
"""POST /api/dictionary/lookup (spec 2026-10-13-defs-default-lookup-ios §3.2): auth, shapes, limits, rate limit,
no word in the URL, nothing logged, nothing stored."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import VocabularyItem, WordbookEvent
from app.wordbook.forms import FILE_NAME
from tests.test_admin_routes_guarded import api_routes
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/dictionary/lookup"
FORMS = b"children\tchild\nwent\tgo\n"


def use_data(app, tmp_path) -> None:
    """Point the app at the mini book + English definitions + forms. The wordbook switch stays OFF on purpose."""
    data = make_data_dir(tmp_path)
    (make_defs_dir(tmp_path) / FILE_NAME).write_bytes(FORMS)
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(data)})
    for name in ("wordbook_dict", "dict_lookup"):
        if hasattr(app.state, name):
            delattr(app.state, name)


async def login(client, name="alice") -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def ask(client, h, text, **extra):
    return await client.post(URL, headers=h, json={"text": text, **extra})


async def test_needs_a_login(app, client, tmp_path):
    use_data(app, tmp_path)
    assert (await client.post(URL, json={"text": "talk"})).status_code == 401
    assert (await client.post(URL, json={"text": "talk"}, headers={"Authorization": "Bearer nope"})).status_code == 401


async def test_a_hit_has_the_documented_shape_and_works_with_the_wordbook_switched_off(app, client, tmp_path):
    use_data(app, tmp_path)
    assert app.state.settings.wordbook_enabled is False
    h = await login(client)
    r = await ask(client, h, "Talk!")
    assert r.status_code == 200
    body = r.json()
    assert list(body) == ["hit", "word", "phonetic", "defs_zh", "defs_en", "phrases", "source", "def_lang"]
    assert body["hit"] is True and body["word"] == "talk" and body["source"] == "dict"
    assert body["def_lang"] in ("both", "zh", "en")
    assert body["defs_zh"][0] == {"pos": "v", "text": "说话；谈话"} and body["defs_en"][0] == {"pos": "v", "text": "speak to someone"}
    assert body["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]


async def test_an_inflected_form_and_a_phrase(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    went = (await ask(client, h, "went")).json()
    assert went["word"] == "went" and went["lemma"] == "go" and went["defs_zh"][0]["text"] == "去；走"
    phrase = (await ask(client, h, "be able to")).json()
    assert phrase["defs_zh"] == [{"pos": "", "text": "能够"}] and phrase["defs_en"] == [] and "phrases" not in phrase


@pytest.mark.parametrize("text", ["zebra", "a b c d", "x" * 41, "谈话", "...", "x" * 1000])
async def test_a_miss_is_exactly_hit_false(app, client, tmp_path, text):
    use_data(app, tmp_path)
    r = await ask(client, await login(client), text)
    assert r.status_code == 200 and r.json() == {"hit": False}


async def test_the_answer_follows_the_users_def_lang(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    (make_defs_dir(tmp_path) / FILE_NAME).write_bytes(FORMS)
    h = await login(client)
    assert (await client.patch("/api/wordbook/enrollment", headers=h, json={"def_lang": "zh"})).status_code == 200
    assert (await ask(client, h, "talk")).json()["def_lang"] == "zh"
    other = await login(client, "bob")
    assert (await ask(client, other, "talk")).json()["def_lang"] in ("both", "en")  # bob never chose: not alice's value


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "x" * 1001}, {"text": 5}, {"text": "talk", "extra": 1}, {"word": "talk"}])
async def test_invalid_bodies_are_422_without_echoing_the_input(app, client, tmp_path, body):
    use_data(app, tmp_path)
    r = await client.post(URL, headers=await login(client), json=body)
    assert r.status_code == 422 and set(r.json()) == {"error"} and "x" * 50 not in r.text


async def test_get_is_not_allowed_and_the_word_is_never_a_path_or_query_parameter(app):
    seen = 0
    for path, route in api_routes(app.routes):
        if path.startswith("/api/dictionary"):
            seen += 1
            assert "{" not in path and not route.dependant.query_params and route.methods == {"POST"}, path
    assert seen == 1


async def test_it_shares_the_ai_rate_limit_bucket(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    app.state.user_limiter.limit = 2
    assert [(await ask(client, h, "talk")).status_code for _ in range(3)] == [200, 200, 429]
    assert (await ask(client, h, "talk")).json() == {"error": "Too many requests, please try again later"}
    other = await login(client, "bob")
    assert (await ask(client, other, "talk")).status_code == 200  # per user


async def test_nothing_is_logged_and_nothing_is_stored(app, client, tmp_path, caplog):
    use_data(app, tmp_path)
    h = await login(client)
    caplog.set_level(logging.DEBUG)
    caplog.clear()
    for text in ("talk", "went", "be able to", "zebra", "a b c d", "谈话", "x" * 100):
        await ask(client, h, text)
    await client.post(URL, headers=h, json={"text": ""})
    await client.post(URL, json={"text": "talk"})
    for word in ("talk", "went", "be able to", "zebra", "谈话"):
        assert word not in caplog.text, word
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == 0
        assert await s.scalar(select(func.count()).select_from(VocabularyItem)) == 0


async def test_it_answers_without_any_dictionary_files(app, client, tmp_path):
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(tmp_path / "nowhere")})
    r = await ask(client, await login(client), "talk")
    assert r.status_code == 200 and r.json() == {"hit": False}
```

- [ ] **Step 4:** Create `server/tests/test_dictionary_contract.py`:

```python
"""POST /api/dictionary/lookup payload shapes (spec 2026-10-13-defs-default-lookup-ios §3.2, plan B). The web contract test
web/src/features/lookup/dictionary-contract.test.ts reads the same file key by key.

Re-record: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_dictionary_contract.py`
(PowerShell: `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_dictionary_contract.py; Remove-Item Env:CONTRACT_UPDATE`).
Separate from wordbook_contract.json on purpose: that file is re-recorded by other work (def_lang default)."""
import json
import os
from pathlib import Path

from tests.test_dictionary_api import ask, login, use_data
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "dictionary_contract.json"
KEYS = {"hit", "inflected", "phrase", "miss"}


async def test_dictionary_payloads_match_the_web_contract(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    actual = {
        "hit": (await ask(client, h, "talk")).json(),
        "inflected": (await ask(client, h, "went")).json(),
        "phrase": (await ask(client, h, "be able to")).json(),
        "miss": (await ask(client, h, "zebra")).json(),
    }
    assert set(actual) == KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    for key in ("hit", "inflected", "phrase"):  # shape() only looks at the first list element: pin the lists
        assert expected[key]["hit"] is True and expected[key]["source"] == "dict" and expected[key]["def_lang"] in ("both", "zh", "en")
        assert expected[key]["defs_zh"] and set(expected[key]["defs_zh"][0]) == {"pos", "text"}
    assert expected["hit"]["defs_en"] and set(expected["hit"]["defs_en"][0]) == {"pos", "text"}
    assert expected["hit"]["phrases"] and set(expected["hit"]["phrases"][0]) == {"en", "zh"}
    assert expected["inflected"]["lemma"] == "go" and "lemma" not in expected["hit"] and "phonetic" in expected["hit"]
    assert expected["phrase"]["defs_en"] == [] and "phrases" not in expected["phrase"]
    assert expected["miss"] == {"hit": False}
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw and str(tmp_path.anchor) not in raw.replace("\\\\", "\\")
```

- [ ] **Step 5:** 录制夹具:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_dictionary_contract.py`(PowerShell 写法见文件头),再不带变量跑一次。临时副本里录得的内容(顶层键 `hit/inflected/phrase/miss`):
  - `hit`:`{"hit":true,"word":"talk","phonetic":"tɔk","defs_zh":[{"pos":"v","text":"说话；谈话"},{"pos":"n","text":"交谈"},{"pos":"n/v","text":"谈话,讲话"}],"defs_en":[3 条],"phrases":[{"en":"talk about","zh":"谈论某事"}],"source":"dict","def_lang":"both"}`(`defs_zh` 第三条文本里的逗号是全角,以录制为准)
  - `inflected`:`word:"went"`、`lemma:"go"`、`phonetic:"ɡo"`、`defs_zh:[{"pos":"v","text":"去;走"}]`、`defs_en:[{"pos":"v","text":"move or travel to a place"}]`、`phrases:[{"en":"go on","zh":"继续"}]`
  - `phrase`:`{"hit":true,"word":"be able to","defs_zh":[{"pos":"","text":"能够"}],"defs_en":[],"source":"dict","def_lang":"both"}`
  - `miss`:`{"hit":false}`
- [ ] **Step 6:** 文档:`server/app/routers/CLAUDE.md` 的 What lives here 加 `dictionary` (`/api/dictionary/lookup`:选词词典,词只在 POST 体,`limited_user`,不受 WORDBOOK_ENABLED 控制;逻辑在 `app/wordbook/lookup.py`;须在 `stubs` 之前);`server/tests/CLAUDE.md` 的 fixtures 行加 `dictionary_contract.json`(`test_dictionary_contract.py` 录制,网页 `dictionary-contract.test.ts` 读取);`server/CLAUDE.md` 的 `dictionaries/` 一行补 `forms.txt`;`server/README.md` 接口一览加一行 `/api/dictionary/lookup  选词词典(POST {text} → {hit,…};需登录;与 AI 共用限流)`。
- [ ] **Step 7:** `cd server && uv run pytest -q tests/test_dictionary_api.py tests/test_dictionary_contract.py tests/test_dictionary_lookup.py tests/test_architecture.py tests/test_admin_routes_guarded.py tests/test_wordbook_api.py` → 全绿。
- [ ] **Step 8: 提交** `feat(server): add POST /api/dictionary/lookup with a recorded web contract`。

---

# 网页(写计划时未运行,见 Global Constraints)

## Task W1:`selectionActions` 扩展点 + chat 的朗读贡献

**Files:** Modify `web/src/lib/extension-points.ts`、`web/src/lib/extension-points.test.tsx`、`web/src/plugins/links-matrix.test.tsx`、`web/src/plugins/core.ts`、`web/src/plugins/CLAUDE.md`、`web/src/lib/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`;Create `web/src/features/chat/read-aloud-action.tsx`、`register-selection-actions.tsx`、`read-aloud-action.test.tsx`。

- [ ] **Step 1:** `lib/extension-points.ts`:`PointProps` 里 `appEffects: Empty;` 之后加
```ts
  /** 选词操作条里的动作(spec 2026-10-13 §3.3):`text` = 选中的文字;`testId` 由消费方给。 */
  selectionActions: { text: string; testId: string };
```
`POINT_NAMES` 末尾追加 `"selectionActions"`:`["wordActions", …, "meRows", "appEffects", "selectionActions"]`。
- [ ] **Step 2:** `lib/extension-points.test.tsx` 第 69 行附近的期望数组末尾加 `"selectionActions"`。`plugins/links-matrix.test.tsx`:
  - `visibleIds(ALL_OFF)` 期望改为 `["appEffects/links.config", "selectionActions/chat.read-aloud", "wordActions/vocabulary.add"]`(按字符串排序);
  - 全开用例里加 `expect(ids("selectionActions")).toEqual(["chat.read-aloud"]);`。
- [ ] **Step 3:** Create `features/chat/read-aloud-action.tsx`:

```tsx
import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import type { PointProps } from "~/lib/extension-points";
import { ttsErrorMessage, useTtsPlayer } from "./use-tts-player";

const KEY = "selection";

/**
 * 选词操作条里的「朗读」(扩展点 selectionActions,R-L5)。iOS:`tts.play` 的同步段先 `primeAudioElement` 再 await 合成,
 * 所以必须在点击处理函数里直接调用(中间不能有 await);TTS 配置在挂载时预载,载入前按钮禁用,没有 TTS 模型则不渲染。
 */
export function ReadAloudAction({ text, testId }: PointProps["selectionActions"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [ai, setAi] = useState<ServerAiConfig | null | undefined>(undefined); // undefined = loading, null = unavailable
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c.defaultTts.model ? c : null); }, (): void => { if (alive) setAi(null); });
    return () => { alive = false; };
  }, [api]);
  const tts = useTtsPlayer(api, {
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    onNothingToRead: () => toast.info(tRef.current("web.chat.nothingToRead")),
  });
  if (ai === null) return null;
  const state = tts.states[KEY] ?? "idle";
  const busy = state === "loading" || state === "playing";
  const click = () => {
    if (busy) { tts.stop(); return; }
    if (!ai) return;
    void tts.play(KEY, text, ai.defaultTts.model, ai.defaultTts.voice); // 同步段内 prime;不要在这之前 await
  };
  const label = busy ? t("web.chat.stopSpeaking") : t("web.chat.speak");
  const Icon = state === "loading" ? LoaderIcon : busy ? SquareIcon : Volume2Icon;
  return (
    <Button variant="ghost" data-testid={testId} data-state={state} aria-label={label} disabled={!ai}
      className="h-11 min-w-11 rounded-full px-3" onClick={click}>
      <Icon className={state === "loading" ? "mr-1.5 h-4 w-4 animate-spin" : "mr-1.5 h-4 w-4"} aria-hidden="true" />{label}
    </Button>
  );
}
```
Create `features/chat/register-selection-actions.tsx`:
```tsx
// 只被 web/src/plugins/ 导入(architecture.test.ts):选词操作条的「朗读」(spec 2026-10-13 §3.3)。核心贡献:无联动键,永远可见。
import { contribute } from "~/lib/extension-points";
import { ReadAloudAction } from "./read-aloud-action";

contribute({ point: "selectionActions", id: "chat.read-aloud", order: 0, component: ReadAloudAction });
```
`plugins/core.ts` 追加一行 `import "~/features/chat/register-selection-actions";`(并把头注释改为「核心贡献:加入生词本、选词朗读」)。
- [ ] **Step 4:** Create `features/chat/read-aloud-action.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ReadAloudAction } from "./read-aloud-action";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const CONFIG: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: [{ value: "alloy" }] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const apiFor = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});
beforeEach(() => { resetServerAiConfigCache(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("ReadAloudAction", () => {
  it("is disabled until the TTS config has loaded, then primes the audio element synchronously inside the click", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let release: () => void = () => {};
    const mock = createFetchMock({
      ...CONFIG,
      "POST /api/ai/audio/speech": () => new Promise((resolve) => { release = () => resolve(new Response(new Uint8Array([1]))); }),
    });
    renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(mock) });
    const button = await screen.findByTestId("read");
    await waitFor(() => expect(button).toBeEnabled());
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1); // the silent priming play(): synchronous, the speech request is still pending
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true);
    expect(button).toHaveAttribute("data-state", "loading");
    release();
    await waitFor(() => expect(button).toHaveAttribute("data-state", "playing"));
    expect(play).toHaveBeenCalledTimes(2); // the real audio
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body)))
      .toEqual({ input: "country", model: "openai/tts-1", voice: "alloy" });
  });

  it("a second click while loading or playing stops instead of starting again", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const mock = createFetchMock({ ...CONFIG, "POST /api/ai/audio/speech": () => new Promise<Response>(() => {}) });
    renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(mock) });
    const button = await screen.findByTestId("read");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-state", "loading");
    fireEvent.click(button);
    expect(pause).toHaveBeenCalled();
    expect(button).toHaveAttribute("data-state", "idle");
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech")).toHaveLength(1);
  });

  it("renders nothing when no TTS model is configured or the config cannot be loaded", async () => {
    const none = createFetchMock({ ...CONFIG, "GET /api/config/tts_providers_v2": () => json({}), "GET /api/config/default_tts_preset": () => json({}) });
    const first = renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(none) });
    await waitFor(() => expect(none.calls.length).toBeGreaterThanOrEqual(4));
    await waitFor(() => expect(screen.queryByTestId("read")).toBeNull());
    first.unmount();
    resetServerAiConfigCache();
    const broken = createFetchMock({});
    renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(broken) });
    await waitFor(() => expect(broken.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByTestId("read")).toBeNull());
  });
});
```
- [ ] **Step 5:** 文档:`plugins/CLAUDE.md` 的点列表加 `selectionActions`(`{ text, testId }`,选词操作条;核心贡献 `chat.read-aloud`),并把「核心贡献」一行改为「`wordActions/vocabulary.add`、`selectionActions/chat.read-aloud`」;`lib/CLAUDE.md` 的 extension-points 一行提一句;`features/chat/CLAUDE.md` 的 What lives here 加 `read-aloud-action.tsx` / `register-selection-actions.tsx`,Pitfalls 加「选词朗读:`tts.play` 必须在点击处理函数里同步调用(iOS)」。
- [ ] **Step 6:** `cd web && yarn vitest run src/features/chat/read-aloud-action.test.tsx src/lib/extension-points.test.tsx src/plugins src/architecture.test.ts`。预期:`links-matrix`、`word-actions` 的 parity 测试仍绿(核心按钮 DOM 不变);若冷编译导致 `test/setup.ts` 钩子超时,先单独重跑确认不是真失败。
- [ ] **Step 7: 提交** `feat(web): add the selectionActions extension point and a read-aloud contribution`。

## Task W2:词典客户端(类型、解析、纯函数、契约测试)

**Files:** Create `web/src/features/lookup/dictionary.ts`、`dictionary.test.ts`、`dictionary-contract.test.ts`。

- [ ] **Step 1:** Create `dictionary.ts`:

```ts
import { type ApiClient } from "~/api/client";
import { inflightDedupe, withSignal } from "~/lib/abortable";
import { normalizeSelection, type LookupResult } from "./lookup";

/** 本地词典命中(服务端 POST /api/dictionary/lookup,计划 B R-L4)。网页只关心命中;未命中 / 出错都是 null。 */
export type DictDefLang = "both" | "zh" | "en";
export interface DictDef { pos: string; text: string }
export interface DictPhrase { en: string; zh: string }
export interface DictEntry {
  word: string;
  lemma?: string;
  phonetic?: string;
  defsZh: DictDef[];
  defsEn: DictDef[];
  phrases: DictPhrase[];
  defLang: DictDefLang;
}

const MAX_TEXT = 1000;
const TIMEOUT_MS = 8_000;
const MAX_PHRASES = 3;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function defs(value: unknown): DictDef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((d) => (isObj(d) && str(d.text).trim() ? [{ pos: str(d.pos), text: str(d.text) }] : []));
}

/** 防御式解析:未命中、形状不对、没有任何释义都返回 null。`defLang` 缺省 / 未知按「仅英文」(spec D1)。 */
export function parseDictionaryResponse(raw: unknown): DictEntry | null {
  if (!isObj(raw) || raw.hit !== true || !str(raw.word)) return null;
  const defsZh = defs(raw.defsZh);
  const defsEn = defs(raw.defsEn);
  if (!defsZh.length && !defsEn.length) return null;
  const phrases = Array.isArray(raw.phrases)
    ? raw.phrases.flatMap((p) => (isObj(p) && str(p.en) ? [{ en: str(p.en), zh: str(p.zh) }] : [])).slice(0, MAX_PHRASES)
    : [];
  const defLang: DictDefLang = raw.defLang === "both" || raw.defLang === "zh" || raw.defLang === "en" ? raw.defLang : "en";
  return {
    word: str(raw.word),
    ...(str(raw.lemma) ? { lemma: str(raw.lemma) } : {}),
    ...(str(raw.phonetic) ? { phonetic: str(raw.phonetic) } : {}),
    defsZh, defsEn, phrases, defLang,
  };
}

const dedupe = inflightDedupe<DictEntry | null>();

/**
 * 词只在 POST 体里。同一个词的飞行中请求共用一次(预取与点击撞在一起时);不缓存结果(含用户的 def_lang 偏好)。
 * 任何错误(含 429、404、超时)都会抛出,调用方当作未命中。
 */
export function lookupDictionary(api: ApiClient, text: string, signal?: AbortSignal): Promise<DictEntry | null> {
  const clean = normalizeSelection(text).slice(0, MAX_TEXT);
  return withSignal(dedupe(JSON.stringify(clean.toLowerCase()), async () =>
    parseDictionaryResponse(await api.request("POST", "/api/dictionary/lookup", { json: { text: clean }, timeoutMs: TIMEOUT_MS }))), signal);
}

/** 抽屉里显示哪些行(spec D2):有效偏好 en 而没有英文释义 → 补显中文;偏好 zh 显示中文;两边都空时有什么显示什么。 */
export function visibleDefs(entry: Pick<DictEntry, "defLang" | "defsZh" | "defsEn">): { zh: DictDef[]; en: DictDef[] } {
  const showEn = entry.defLang !== "zh" && entry.defsEn.length > 0;
  const showZh = entry.defLang !== "en" || entry.defsEn.length === 0;
  const zh = showZh ? entry.defsZh : [];
  const en = showEn ? entry.defsEn : [];
  return !zh.length && !en.length ? { zh: entry.defsZh, en: entry.defsEn } : { zh, en };
}

const EN_POS: Record<string, string> = {
  n: "n.", v: "v.", a: "adj.", r: "adv.", prep: "prep.", pron: "pron.", conj: "conj.", art: "art.", num: "num.", aux: "aux.", int: "interj.",
};
export const enPosLabel = (pos: string): string => EN_POS[pos] ?? pos;

/** 词典命中 → 既有的 LookupResult,供 wordTargetFromLookup 生成「加入生词本」的 target(释义 = 词性 · 中文 · 英文)。 */
export function dictToLookup(entry: DictEntry): LookupResult {
  const zh = entry.defsZh.slice(0, 2).map((d) => (d.pos ? `${d.pos}. ${d.text}` : d.text)).join("；");
  return {
    word: entry.word, lemma: entry.lemma ?? "", pronunciation: entry.phonetic ?? "", pos: "",
    definition: entry.defsEn[0]?.text ?? "", translation: zh, contextTranslation: "",
  };
}

/** 还没有词典结果时「加入」按钮用的空结果(只有词本身)。 */
export const bareLookup = (word: string): LookupResult =>
  ({ word, lemma: "", pronunciation: "", pos: "", definition: "", translation: "", contextTranslation: "" });
```

- [ ] **Step 2:** Create `dictionary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { bareLookup, dictToLookup, enPosLabel, lookupDictionary, parseDictionaryResponse, visibleDefs, type DictEntry } from "./dictionary";

const HIT = {
  hit: true, word: "went", lemma: "go", phonetic: "ɡo", source: "dict", def_lang: "en",
  defs_zh: [{ pos: "v", text: "去;走" }], defs_en: [{ pos: "v", text: "move or travel to a place" }],
  phrases: [{ en: "go on", zh: "继续" }],
};
const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
const entry = (over: Partial<DictEntry> = {}): DictEntry => ({
  word: "go", defsZh: [{ pos: "v", text: "去" }], defsEn: [{ pos: "v", text: "move" }], phrases: [], defLang: "both", ...over,
});

describe("parseDictionaryResponse", () => {
  it("maps a hit (camel-cased by the client)", () => {
    const camel = { hit: true, word: "went", lemma: "go", phonetic: "ɡo", defsZh: HIT.defs_zh, defsEn: HIT.defs_en, phrases: HIT.phrases, defLang: "en" };
    expect(parseDictionaryResponse(camel)).toEqual({
      word: "went", lemma: "go", phonetic: "ɡo", defsZh: HIT.defs_zh, defsEn: HIT.defs_en, phrases: HIT.phrases, defLang: "en",
    });
  });
  it("treats misses and malformed answers as null", () => {
    for (const raw of [null, undefined, "x", [], { hit: false }, { hit: true }, { hit: true, word: "a" }, { hit: true, word: "a", defsZh: [], defsEn: [] },
      { hit: true, word: "a", defsZh: [{ pos: "n", text: "  " }] }, { hit: "true", word: "a", defsZh: [{ text: "x" }] }]) {
      expect(parseDictionaryResponse(raw)).toBeNull();
    }
  });
  it("defaults the missing parts: no phrases, unknown def_lang means English only, at most three phrases", () => {
    const raw = { hit: true, word: "a", defsZh: [{ text: "甲" }], defLang: "fr", phrases: [{ en: "a", zh: "1" }, { en: "b", zh: "2" }, { en: "c", zh: "3" }, { en: "d", zh: "4" }, { zh: "x" }] };
    expect(parseDictionaryResponse(raw)).toEqual({ word: "a", defsZh: [{ pos: "", text: "甲" }], defsEn: [], defLang: "en",
      phrases: [{ en: "a", zh: "1" }, { en: "b", zh: "2" }, { en: "c", zh: "3" }] });
  });
});

describe("lookupDictionary", () => {
  it("posts the text in the body only, never in the URL, and parses the answer", async () => {
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json(HIT) });
    const result = await lookupDictionary(api(mock), "  Went \n");
    expect(result?.lemma).toBe("go");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].url.pathname).not.toContain("went");
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ text: "Went" });
  });
  it("returns null for a miss and rejects on errors (the caller falls back to the AI)", async () => {
    expect(await lookupDictionary(api(createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) })), "zebra")).toBeNull();
    await expect(lookupDictionary(api(createFetchMock({ "POST /api/dictionary/lookup": () => json({ error: "Too many requests" }, 429) })), "zebra"))
      .rejects.toBeInstanceOf(ApiError);
    await expect(lookupDictionary(api(createFetchMock({})), "zebra")).rejects.toMatchObject({ status: 404 });
  });
  it("shares one in-flight request per word and does not remember results", async () => {
    let release: () => void = () => {};
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(HIT)); }) });
    const a = lookupDictionary(api(mock), "went");
    const b = lookupDictionary(api(mock), "WENT");
    release();
    await Promise.all([a, b]);
    expect(mock.calls).toHaveLength(1);
    const again = lookupDictionary(api(mock), "went");
    release();
    await again;
    expect(mock.calls).toHaveLength(2);
  });
  it("lets a caller leave without cancelling the shared request", async () => {
    let release: () => void = () => {};
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(HIT)); }) });
    const ctl = new AbortController();
    const left = lookupDictionary(api(mock), "went", ctl.signal);
    ctl.abort();
    await expect(left).rejects.toMatchObject({ name: "AbortError" });
    release();
  });
});

describe("visibleDefs (spec D2)", () => {
  it("both shows both, zh shows Chinese only, en shows English only", () => {
    expect(visibleDefs(entry({ defLang: "both" }))).toEqual({ zh: entry().defsZh, en: entry().defsEn });
    expect(visibleDefs(entry({ defLang: "zh" }))).toEqual({ zh: entry().defsZh, en: [] });
    expect(visibleDefs(entry({ defLang: "en" }))).toEqual({ zh: [], en: entry().defsEn });
  });
  it("English only falls back to Chinese when there is no English definition", () => {
    expect(visibleDefs(entry({ defLang: "en", defsEn: [] }))).toEqual({ zh: entry().defsZh, en: [] });
  });
  it("shows whatever exists when the preferred side is empty", () => {
    expect(visibleDefs(entry({ defLang: "zh", defsZh: [] }))).toEqual({ zh: [], en: entry().defsEn });
  });
});

describe("mapping helpers", () => {
  it("dictToLookup builds the meaning parts the add button uses", () => {
    const lookup = dictToLookup(entry({ word: "went", lemma: "go", phonetic: "ɡo", defsZh: [{ pos: "v", text: "去" }, { pos: "n", text: "走" }, { pos: "", text: "三" }] }));
    expect(lookup).toEqual({ word: "went", lemma: "go", pronunciation: "ɡo", pos: "", definition: "move", translation: "v. 去；n. 走", contextTranslation: "" });
  });
  it("labels English POS codes and passes unknown ones through", () => {
    expect(enPosLabel("a")).toBe("adj."); expect(enPosLabel("r")).toBe("adv."); expect(enPosLabel("zz")).toBe("zz");
  });
  it("bareLookup carries only the word", () => {
    expect(bareLookup("go")).toMatchObject({ word: "go", definition: "", translation: "" });
  });
});
```
- [ ] **Step 3:** Create `dictionary-contract.test.ts`(读服务端夹具,必须存在,不 skip):

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseDictionaryResponse } from "./dictionary";

/** 契约(计划 B R-L7):`server/tests/fixtures/dictionary_contract.json` 由服务端 `test_dictionary_contract.py` 录制,这里逐键核对网页解析。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/dictionary_contract.json"), "utf8")) as Record<string, Record<string, unknown>>;
const cc = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true });
const keys = (o: object) => Object.keys(o).sort();

describe("dictionary contract", () => {
  it("has the four recorded answers", () => {
    expect(keys(contract)).toEqual(["hit", "inflected", "miss", "phrase"]);
  });
  it("a headword hit parses with every wire key accounted for", () => {
    expect(keys(contract.hit)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "phonetic", "phrases", "source", "word"]);
    const parsed = parseDictionaryResponse(cc(contract.hit))!;
    expect(parsed.word).toBe("talk");
    expect(parsed.lemma).toBeUndefined();
    expect(parsed.defsZh.length).toBeGreaterThan(0);
    expect(parsed.defsEn.length).toBeGreaterThan(0);
    expect(parsed.phrases).toEqual([{ en: "talk about", zh: "谈论某事" }]);
    expect(["both", "zh", "en"]).toContain(parsed.defLang);
  });
  it("an inflected hit carries the lemma", () => {
    expect(keys(contract.inflected)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "lemma", "phonetic", "phrases", "source", "word"]);
    expect(parseDictionaryResponse(cc(contract.inflected))).toMatchObject({ word: "went", lemma: "go" });
  });
  it("a phrase hit has Chinese only and no phrases key", () => {
    expect(keys(contract.phrase)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "source", "word"]);
    const parsed = parseDictionaryResponse(cc(contract.phrase))!;
    expect(parsed.defsEn).toEqual([]);
    expect(parsed.defsZh).toEqual([{ pos: "", text: "能够" }]);
    expect(parsed.phrases).toEqual([]);
  });
  it("a miss is exactly {hit:false} and parses to null", () => {
    expect(contract.miss).toEqual({ hit: false });
    expect(parseDictionaryResponse(cc(contract.miss))).toBeNull();
  });
});
```
- [ ] **Step 4:** `cd web && yarn vitest run src/features/lookup/dictionary.test.ts src/features/lookup/dictionary-contract.test.ts`(需 S4 已合并夹具)。
- [ ] **Step 5: 提交** `feat(web): add the local dictionary client for select-to-lookup`。

## Task W3:操作条、词典结果、查词流程

**Files:** Create `features/lookup/use-dictionary-prefetch.ts`、`dictionary-result.tsx`、`lookup-bar.tsx`、`lookup-bar.test.tsx`;Modify `lookup-layer.tsx`(整体替换为下方版本)、`lookup-layer.test.tsx`、`i18n/en.json`、`i18n/zh-CN.json`。**`features/lookup/index.ts` 不改**(没有新的外部用户)。

- [ ] **Step 1:** i18n。`en.json` 的 `web.lookup` 追加(保持中英同键):
`"sourceDict": "Dictionary", "sourceAi": "AI lookup", "aiExplain": "Explain in context with AI", "barLabel": "Selection actions", "phrases": "Phrases"`;`zh-CN.json`:`"sourceDict": "词典", "sourceAi": "AI 查询", "aiExplain": "AI 结合语境讲解", "barLabel": "选中文字操作", "phrases": "短语"`。
- [ ] **Step 2:** Create `use-dictionary-prefetch.ts`:

```ts
import { useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { classifySelection, normalizeSelection } from "./lookup";
import { lookupDictionary, type DictEntry } from "./dictionary";
import type { TextSelectionInfo } from "./use-text-selection";

/**
 * 选中单词 / 短语(防抖后稳定)就问一次本地词典,让操作条里的「加入生词本」带上中文释义(R-L6)。
 * undefined = 还没结果;null = 未命中或失败(静默);只保存在组件状态里,不跨选区缓存。
 */
export function useDictionaryPrefetch(selection: TextSelectionInfo | null): DictEntry | null | undefined {
  const { api } = useAuth();
  const [state, setState] = useState<{ text: string; entry: DictEntry | null } | null>(null);
  const text = selection && classifySelection(selection.text) === "lookup" ? normalizeSelection(selection.text) : null;
  useEffect(() => {
    if (!text) { setState(null); return; }
    const ctl = new AbortController();
    lookupDictionary(api, text, ctl.signal).then(
      (entry) => { if (!ctl.signal.aborted) setState({ text, entry }); },
      () => { if (!ctl.signal.aborted) setState({ text, entry: null }); },
    );
    return () => ctl.abort();
  }, [api, text]);
  return state && state.text === text ? state.entry : undefined;
}
```
- [ ] **Step 3:** Create `dictionary-result.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { enPosLabel, visibleDefs, type DictEntry } from "./dictionary";

/** 抽屉里词典命中的显示:词 / 音标 / 原形 / 中文释义 / 英文释义(遵守 def_lang)/ 最多 3 条短语。 */
export function DictionaryResult({ entry }: { entry: DictEntry }) {
  const { t } = useTranslation();
  const { zh, en } = visibleDefs(entry);
  return (
    <div data-testid="lookup-dict" className="space-y-2">
      <p className="text-lg font-semibold">
        {entry.word}
        {entry.phonetic && <span className="ml-2 font-code font-normal text-muted-foreground">/{entry.phonetic}/</span>}
      </p>
      {entry.lemma && entry.lemma.toLowerCase() !== entry.word.toLowerCase() && (
        <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {entry.lemma}</p>
      )}
      {zh.length > 0 && (
        <ul data-testid="lookup-dict-zh" className="space-y-0.5">
          {zh.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}>{d.pos && <span className="mr-1.5 text-sm text-muted-foreground">{d.pos}</span>}{d.text}</li>
          ))}
        </ul>
      )}
      {en.length > 0 && (
        <ul data-testid="lookup-dict-en" className="space-y-0.5 text-sm text-ink-2">
          {en.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}><span className="mr-1.5 text-muted-foreground">{enPosLabel(d.pos)}</span>{d.text}</li>
          ))}
        </ul>
      )}
      {entry.phrases.length > 0 && (
        <div data-testid="lookup-dict-phrases">
          <p className="text-sm text-muted-foreground">{t("web.lookup.phrases")}</p>
          <ul className="space-y-0.5 text-sm">
            {entry.phrases.map((p) => <li key={p.en}><span className="font-medium">{p.en}</span>{p.zh && <span className="ml-2 text-muted-foreground">{p.zh}</span>}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 4:** Create `lookup-bar.tsx`:

```tsx
import { LanguagesIcon, SearchIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Slot, WordActions } from "~/lib/extension-points-react";
import { bareLookup, dictToLookup, type DictEntry } from "./dictionary";
import { normalizeSelection, type LookupMode } from "./lookup";
import type { TextSelectionInfo } from "./use-text-selection";
import { wordTargetFromLookup } from "./word-target";

const keep = (e: { preventDefault: () => void }) => e.preventDefault(); // 点按钮不能让系统选区消失

/**
 * 选中后的底部操作条(spec D6):查词(长句为「翻译」)· 朗读(扩展点 selectionActions)· 加入生词本(<WordActions>,只对单词 / 短语)。
 * 点击不抢焦点(preventDefault),沿用原触发按钮的位置与 data-testid="lookup-trigger"。
 */
export function LookupBar({ selection, suggested, entry, onOpen }: {
  selection: TextSelectionInfo;
  suggested: LookupMode;
  entry: DictEntry | null | undefined;
  onOpen: (info: TextSelectionInfo) => void;
}) {
  const { t } = useTranslation();
  const target = useMemo(
    () => wordTargetFromLookup(entry ? dictToLookup({ ...entry, word: normalizeSelection(selection.text) }) : bareLookup(normalizeSelection(selection.text)), selection),
    [entry, selection],
  );
  return (
    <div role="toolbar" aria-label={t("web.lookup.barLabel")} data-testid="lookup-bar"
      className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg"
      onPointerDown={keep} onMouseDown={keep}>
      <Button data-testid="lookup-trigger" className="h-11 rounded-full px-4" onClick={() => onOpen(selection)}>
        {suggested === "lookup" ? <SearchIcon className="mr-1.5 h-4 w-4" /> : <LanguagesIcon className="mr-1.5 h-4 w-4" />}
        {suggested === "lookup" ? t("web.lookup.lookup") : t("web.lookup.translate")}
      </Button>
      <Slot point="selectionActions" props={{ text: selection.text, testId: "lookup-read" }} />
      {suggested === "lookup" && (
        <WordActions key={`${selection.text}\n${selection.context}`} testId="lookup-bar-vocab" variant="icon" target={target} />
      )}
    </div>
  );
}
```
注意 `dictToLookup({ ...entry, word: <选区文字> })`:加入生词本的词用用户选中的写法(与操作条在词典结果到达前后保持同一个词,避免「已加入」状态因词变化而重置);抽屉里的 `lookup-vocab` 沿用既有行为(用结果的 `word`)。
- [ ] **Step 5:** 把 `lookup-layer.tsx` 整体替换为:

```tsx
import { LoaderIcon, MicIcon, SparklesIcon, StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { MAX_PRACTICE_TEXT, goPractice, savePracticeItem } from "~/features/practice";
import { WordActions } from "~/lib/extension-points-react";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { DictionaryResult } from "./dictionary-result";
import { dictToLookup, lookupDictionary, type DictEntry } from "./dictionary";
import { LOOKUP_SERVER_ERRORS, cachedLookup, cachedTranslate, classifySelection, normalizeSelection, type LookupMode, type LookupResult } from "./lookup";
import { LookupBar } from "./lookup-bar";
import { useDictionaryPrefetch } from "./use-dictionary-prefetch";
import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";
import { wordTargetFromLookup } from "./word-target";

type LookupState =
  | { status: "loading" }
  | { status: "done"; source?: "dict" | "ai"; dict?: DictEntry; lookup?: LookupResult; translation?: string }
  | { status: "error"; error: string };
type AiState = { status: "idle" } | { status: "loading" } | { status: "done"; lookup: LookupResult } | { status: "error"; error: string };

const SWIPE_CLOSE_PX = 60;

export function LookupLayer() {
  const { api } = useAuth();
  const { language } = useSettings();
  const { t } = useTranslation();
  const { selection, clear } = useTextSelection();
  const prefetched = useDictionaryPrefetch(selection);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TextSelectionInfo | null>(null);
  const [mode, setMode] = useState<LookupMode>("lookup");
  const [state, setState] = useState<LookupState>({ status: "loading" });
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const native = nativeLanguageCode(language);
  const controller = useRef<AbortController | null>(null);
  const aiController = useRef<AbortController | null>(null);
  const touchStart = useRef<number | null>(null);
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const passageText = target ? normalizeSelection(target.text) : "";
  const isPassage = !!target && classifySelection(target.text) === "translate";
  // 词汇本只收单词/短语:长句即使切到"查词"也不提供
  const isWordOrPhrase = !!target && classifySelection(target.text) === "lookup";
  const tooLong = passageText.length > MAX_PRACTICE_TEXT;

  const save = async () => {
    if (saving || !passageText || tooLong) return;
    setSaving(true);
    try {
      await savePracticeItem(api, t, passageText, "lookup");
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    aiController.current?.abort();
    aiController.current = null;
  }, []);
  useEffect(() => abort, [abort]); // no request outlives the layer

  const run = useCallback(async (info: TextSelectionInfo, nextMode: LookupMode) => {
    abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setMode(nextMode);
    setState({ status: "loading" });
    setAi({ status: "idle" });
    try {
      let next: LookupState;
      if (nextMode === "lookup") {
        // 先本地词典(便宜,无上游成本);未命中或任何错误都静默回退大模型(spec D7、§3.3)。长句不问词典。
        const dict = classifySelection(info.text) === "lookup" ? await lookupDictionary(api, info.text, ctl.signal).catch((): null => null) : null;
        if (ctl.signal.aborted) return;
        next = dict
          ? { status: "done", source: "dict", dict }
          : { status: "done", source: "ai", lookup: await cachedLookup(api, { word: info.text, context: info.context, nativeLanguage: native }, ctl.signal) };
      } else {
        next = { status: "done", translation: await cachedTranslate(api, { text: info.text, nativeLanguage: native }, ctl.signal) };
      }
      if (!ctl.signal.aborted) setState(next);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setState({ status: "error", error: translateServerError(t, err, LOOKUP_SERVER_ERRORS) });
    }
  }, [abort, api, native, t]);

  /** 词典命中后的「AI 结合语境讲解」:点了才调现有大模型查询(R-L10)。 */
  const explain = async () => {
    if (!target || ai.status === "loading") return;
    aiController.current?.abort();
    const ctl = new AbortController();
    aiController.current = ctl;
    setAi({ status: "loading" });
    try {
      const lookup = await cachedLookup(api, { word: target.text, context: target.context, nativeLanguage: native }, ctl.signal);
      if (!ctl.signal.aborted) setAi({ status: "done", lookup });
    } catch (err) {
      if (!ctl.signal.aborted) setAi({ status: "error", error: translateServerError(t, err, LOOKUP_SERVER_ERRORS) });
    }
  };

  const openFor = (info: TextSelectionInfo) => {
    setTarget(info);
    setOpen(true);
    void run(info, classifySelection(info.text) ?? "translate");
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      abort();
      clear();
    }
  };

  // 「单词操作」面板(联动 word_actions)里的「跟读这个词」从查词面板之上跳到跟读页:前进导航(PUSH)时收起查词面板。
  // 联动关闭时查词面板里的每个跳转都先自己关闭,前进导航不会在打开时发生,所以行为与今天相同;返回(POP)不处理。
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (pathname === shownAt.current) return;
    shownAt.current = pathname;
    if (open && navigationType === "PUSH") onOpenChange(false);
  }); // 每次渲染比较路径:只在路径真的变了时动作

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start !== null && e.changedTouches[0].clientY - start > SWIPE_CLOSE_PX) onOpenChange(false);
  };

  const suggested = selection ? classifySelection(selection.text) : null;
  const done = state.status === "done" ? state : null;
  // 抽屉里「加入词汇本」的来源:词典命中用词典结果,否则用大模型结果(与改动前相同)
  const addSource = done?.dict ? dictToLookup(done.dict) : done?.lookup;

  return (
    <>
      {selection && suggested && !open && <LookupBar selection={selection} suggested={suggested} entry={prefetched} onOpen={openFor} />}
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="lookup-drawer"
          className="max-h-[70dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="-mt-3 mb-2 flex h-6 touch-none justify-center" aria-hidden="true" data-testid="lookup-grabber"
            onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
            <span className="mt-2 h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <SheetHeader>
            <SheetTitle className="line-clamp-3 text-left">{target?.text}</SheetTitle>
            <SheetDescription className="sr-only">{t("web.lookup.drawerDescription")}</SheetDescription>
          </SheetHeader>
          <div data-testid="lookup-result" data-status={state.status} aria-live="polite" className="mt-3 select-text space-y-2 text-base">
            {state.status === "loading" && <LoaderIcon className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
            {state.status === "error" && <p role="alert" className="text-destructive">{state.error}</p>}
            {done?.source && (
              <p data-testid="lookup-source" data-source={done.source} className="text-xs text-muted-foreground">
                {done.source === "dict" ? t("web.lookup.sourceDict") : t("web.lookup.sourceAi")}
              </p>
            )}
            {done?.dict && <DictionaryResult entry={done.dict} />}
            {done?.lookup && <AiLookup lookup={done.lookup} fallbackWord={target?.text ?? ""} />}
            {done && done.translation !== undefined && <p className="whitespace-pre-wrap">{done.translation}</p>}
          </div>
          {done?.dict && (
            <div className="mt-3">
              {ai.status === "idle" && (
                <Button variant="outline" data-testid="lookup-ai-explain" className="h-11 w-full" onClick={() => void explain()}>
                  <SparklesIcon className="mr-2 h-4 w-4" />{t("web.lookup.aiExplain")}
                </Button>
              )}
              {ai.status === "loading" && <LoaderIcon data-testid="lookup-ai-loading" className="h-5 w-5 animate-spin" aria-label={t("web.common.loading")} />}
              {ai.status === "error" && (
                <div className="space-y-2">
                  <p role="alert" className="text-destructive">{ai.error}</p>
                  <Button variant="outline" data-testid="lookup-ai-retry" className="h-11 w-full" onClick={() => void explain()}>{t("web.common.retry")}</Button>
                </div>
              )}
              {ai.status === "done" && (
                <div data-testid="lookup-ai-result" className="select-text space-y-2 border-t pt-3">
                  <p data-testid="lookup-ai-source" className="text-xs text-muted-foreground">{t("web.lookup.sourceAi")}</p>
                  <AiLookup lookup={ai.lookup} fallbackWord={target?.text ?? ""} />
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="outline" data-testid="lookup-switch-mode" className="h-11 flex-1"
              disabled={!target || state.status === "loading"}
              onClick={() => target && void run(target, mode === "lookup" ? "translate" : "lookup")}>
              {mode === "lookup" ? t("web.lookup.translateInstead") : t("web.lookup.lookupInstead")}
            </Button>
            {state.status === "error" && target && (
              <Button data-testid="lookup-retry" className="h-11 flex-1" onClick={() => void run(target, mode)}>{t("web.common.retry")}</Button>
            )}
          </div>
          {addSource && isWordOrPhrase && target && (
            <div className="mt-2 flex">
              <WordActions key={`${target.text}
${target.context}`} testId="lookup-vocab" variant="labeled" target={wordTargetFromLookup(addSource, target)} />
            </div>
          )}
          {isPassage && (
            <div className="mt-2">
              <div className="flex gap-2">
                <Button variant="outline" data-testid="lookup-practice" className="h-11 min-w-11 flex-1" disabled={tooLong}
                  onClick={() => { onOpenChange(false); goPractice(navigate, passageText); }}>
                  <MicIcon className="mr-2 h-4 w-4" />{t("web.lookup.practice")}
                </Button>
                <Button variant="outline" data-testid="lookup-save" className="h-11 min-w-11 flex-1" disabled={tooLong || saving}
                  onClick={() => void save()}>
                  <StarIcon className="mr-2 h-4 w-4" />{t("web.lookup.save")}
                </Button>
              </div>
              {tooLong && <p data-testid="lookup-too-long" className="mt-1 text-sm text-muted-foreground">{t("web.lookup.tooLong")}</p>}
            </div>
          )}
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

/** 大模型查词结果(原来内联在抽屉里的那一段,逐项相同)。 */
function AiLookup({ lookup, fallbackWord }: { lookup: LookupResult; fallbackWord: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-lg font-semibold">
        {lookup.word || fallbackWord}
        {lookup.pronunciation && <span className="ml-2 font-code font-normal text-muted-foreground">/{lookup.pronunciation}/</span>}
        {lookup.pos && <span className="ml-2 text-sm font-normal text-muted-foreground">{lookup.pos}</span>}
      </p>
      {lookup.lemma && lookup.lemma !== lookup.word && <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {lookup.lemma}</p>}
      {lookup.definition && <p>{lookup.definition}</p>}
      {lookup.translation && <p className="font-medium">{lookup.translation}</p>}
      {lookup.contextTranslation && <p className="border-l-2 pl-2 text-sm text-muted-foreground">{lookup.contextTranslation}</p>}
    </>
  );
}
```
(原文件里 `WordActions` 的 `key` 是跨行模板串,上面保持了同样的写法。)
- [ ] **Step 6:** 修改既有 `lookup-layer.test.tsx`:现在每次选词会多出词典请求(404 → 静默回退)和 TTS 配置请求,所以按路径计数。文件顶部 `Page` 之前加 `const aiCalls = (mock: { calls: Array<{ url: URL }> }) => mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions");`,并改 4 处:
  - 第一个用例两处 `expect(mock.calls).toHaveLength(2);` → `expect(aiCalls(mock)).toHaveLength(2);`
  - 第二个用例 `JSON.parse(mock.calls[1].body as string).response_format` → `JSON.parse(aiCalls(mock)[1].body as string).response_format`
  - 「ignores text selected inside the open drawer」里 `const callsBefore = mock.calls.length;` 与最后的 `expect(mock.calls.length).toBe(callsBefore);` 保持原样(选区在抽屉里时不发任何请求,仍成立)。
  其余用例(`lookup-vocab` 的精确请求体、`lookup-switch-mode`、实践 / 收藏)在词典 404 回退下行为不变,不必改。
- [ ] **Step 7:** Create `lookup-bar.test.tsx`:

```tsx
import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const DICT_HIT = {
  hit: true, word: "country", phonetic: "ˈkʌntri", source: "dict", def_lang: "both",
  defs_zh: [{ pos: "n", text: "国家" }, { pos: "n", text: "乡下" }],
  defs_en: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
};
const AI = '{"word":"country","pos":"noun","definition":"a nation","translation":"国家","context_translation":"国家能为你做什么"}';
const CONFIG: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: [{ value: "alloy" }] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const ai = (mock: { calls: Array<{ url: URL }> }) => mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions");
const dict = (mock: { calls: Array<{ url: URL }> }) => mock.calls.filter((c) => c.url.pathname === "/api/dictionary/lookup");

function Page() {
  return (
    <>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </>
  );
}

async function selectText(needle: string) {
  const node = screen.getByTestId("ctx").firstChild!;
  const start = node.textContent!.indexOf(needle);
  await act(async () => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
const mount = (routes: Record<string, Handler>) => {
  const mock = createFetchMock({ ...CONFIG, ...routes });
  renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
};

describe("selection action bar", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("shows lookup, read aloud and add-to-vocabulary for a word", async () => {
    mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT) });
    await selectText("country");
    expect(await screen.findByTestId("lookup-trigger")).toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(await screen.findByTestId("lookup-read")).toBeInTheDocument();
    expect(screen.getByTestId("lookup-bar-vocab")).toBeInTheDocument();
  });

  it("offers translate and read aloud, but no add button, for a sentence and asks the dictionary nothing", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT) });
    await selectText("ask not what your country");
    expect(await screen.findByTestId("lookup-trigger")).toHaveTextContent("Translate");
    expect(await screen.findByTestId("lookup-read")).toBeInTheDocument();
    expect(screen.queryByTestId("lookup-bar-vocab")).toBeNull();
    expect(dict(mock)).toHaveLength(0);
  });

  it("adds the selected word with the dictionary meaning from the bar, without opening the drawer", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT), "POST /api/vocabulary": () => json({ id: "v1" }) });
    await selectText("country");
    await waitFor(() => expect(dict(mock)).toHaveLength(1));
    await userEvent.click(await screen.findByTestId("lookup-bar-vocab"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/vocabulary")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string)).toEqual({
      word: "country", meaning: "n. 国家；n. 乡下 · a nation with its own government", example: "ask not what your country can do for you", source: "lookup",
    });
    expect(screen.queryByTestId("lookup-drawer")).toBeNull();
  });
});

describe("dictionary-first lookup", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("shows a hit at once, labelled as dictionary, with no AI request until asked", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "dict");
    expect(screen.getByTestId("lookup-source")).toHaveTextContent("Dictionary");
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
    expect(screen.getByTestId("lookup-dict-en")).toHaveTextContent("a nation with its own government");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("country club");
    expect(screen.getByTestId("lookup-result")).toHaveTextContent("/ˈkʌntri/");
    expect(ai(mock)).toHaveLength(0);
  });

  it("the AI explanation button calls the model once, with the sentence as context, and shows it below", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await userEvent.click(await screen.findByTestId("lookup-ai-explain"));
    await waitFor(() => expect(screen.getByTestId("lookup-ai-result")).toHaveTextContent("国家能为你做什么"));
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
    expect(ai(mock)).toHaveLength(1);
    expect(JSON.parse(JSON.parse(ai(mock)[0].body as string).messages[1].content)).toEqual({
      word: "country", context: "ask not what your country can do for you",
    });
    expect(screen.getByTestId("lookup-dict")).toBeInTheDocument(); // the dictionary part stays
  });

  it("a miss goes straight to the AI and is labelled as such", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json({ hit: false }),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("a nation"));
    expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "ai");
    expect(screen.getByTestId("lookup-source")).toHaveTextContent("AI lookup");
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
    expect(ai(mock)).toHaveLength(1);
  });

  it("a dictionary failure (429, 500, network) silently falls back to the AI path", async () => {
    for (const failing of [() => json({ error: "Too many requests, please try again later" }, 429), () => json({ error: "boom" }, 500)]) {
      resetKvCacheForTests();
      indexedDB.deleteDatabase("enjoy-web");
      const mock = mount({
        "POST /api/dictionary/lookup": failing,
        "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
      });
      await selectText("country");
      await userEvent.click(await screen.findByTestId("lookup-trigger"));
      await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
      expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "ai");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(ai(mock)).toHaveLength(1);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
      document.body.innerHTML = "";
    }
  });

  it("an AI error after a dictionary miss is translated, not the raw server text", async () => {
    mount({
      "POST /api/dictionary/lookup": () => json({ hit: false }),
      "POST /api/ai/chat/completions": () => json({ error: "Upstream unavailable" }, 502),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "error"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upstream unavailable");
  });

  it("English only with no English definition shows the Chinese ones (spec D2)", async () => {
    mount({ "POST /api/dictionary/lookup": () => json({ ...DICT_HIT, def_lang: "en", defs_en: [] }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家"));
    expect(screen.queryByTestId("lookup-dict-en")).toBeNull();
  });

  it("the drawer's add button uses the dictionary meaning", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT), "POST /api/vocabulary": () => json({ id: "v1" }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await userEvent.click(await screen.findByTestId("lookup-vocab"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/vocabulary")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string).word).toBe("country");
  });

  it("a long selection never asks the dictionary and the translate path is unchanged", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: "不要问" } }] }),
    });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("不要问"));
    expect(dict(mock)).toHaveLength(0);
    expect(screen.queryByTestId("lookup-source")).toBeNull();
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
  });

  it("switching to the dictionary on a sentence does not ask the server either", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": (call) => (JSON.parse(call.body as string).response_format
        ? json({ choices: [{ message: { content: '{"word":"x","definition":"a quote"}' } }] })
        : json({ choices: [{ message: { content: "译文" } }] })),
    });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("译文"));
    await userEvent.click(screen.getByTestId("lookup-switch-mode"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("a quote"));
    expect(dict(mock)).toHaveLength(0);
  });

  it("closing the drawer mid-request ignores a late dictionary answer", async () => {
    let release: () => void = () => {};
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = mount({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(DICT_HIT)); }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "loading");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(ai(mock)).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
```
- [ ] **Step 8:** 架构:`cd web && yarn vitest run src/features/lookup src/plugins src/architecture.test.ts`。预期 `architecture.test.ts` 全绿且**未改动**:`lookup-bar.tsx` 只导入 `~/lib/extension-points-react`、同 feature 文件与 `@renderer/*`;`CROSS_FEATURE_BASELINE.size` 仍 18。
- [ ] **Step 9:** `lookup/CLAUDE.md`:What lives here 加 `dictionary.ts`(本地词典客户端与纯函数)、`use-dictionary-prefetch.ts`、`dictionary-result.tsx`、`lookup-bar.tsx`(选词操作条:查词 · 朗读(扩展点 `selectionActions`)· 加入生词本(`<WordActions variant="icon">`));Pitfalls 加:「词典优先:`run` 先 `lookupDictionary`,未命中 / 任何错误静默回退大模型;长句不问词典;词典结果不缓存(带用户 def_lang)」「朗读由 chat 贡献,lookup 不导入 chat」「操作条沿用 `data-testid="lookup-trigger"` 给查词 / 翻译按钮」。
- [ ] **Step 10: 提交** `feat(web): selection action bar with dictionary-first lookup and AI explain`。

## Task W4:E2E 规格、README、体积与收尾

**Files:** Modify `web/e2e/lookup.spec.ts`、`web/e2e/vocabulary.spec.ts`、`web/README.md`。

- [ ] **Step 1(不运行,E2E 会花钱):** `e2e/lookup.spec.ts` 第一个用例里「country」现在由词典回答(E2E 栈带词典文件):
  - 第 1 段把 `expect(aiCalls).toBe(1);` 改为 `expect(aiCalls).toBe(0);`,并在其后加 `await expect(page.getByTestId("lookup-source")).toHaveAttribute("data-source", "dict");`;`toContainText(/[一-鿿]/)` 保留(中文释义)。
  - 第 2 段(整句翻译)原 `aiCalls` 期望 `2` → `1`;第 3、4 段的期望 `2` → `1`(词典请求不计入,因为只数 `/api/ai/chat/completions`)。第 3 段注释「served from the IndexedDB cache」改为「词典命中不走 AI,翻译仍走缓存」;`wordResult` 比较前先 `await expect(result).toContainText(...)` 即可,不要比整段文本(词典结果含用户偏好,不缓存)。
  - 末尾新增一个用例「AI 结合语境讲解」:选 `country` → 点 `lookup-trigger` → 点 `lookup-ai-explain` → 期望 `lookup-ai-result` 可见且 `aiCalls === 1`。
  `e2e/vocabulary.spec.ts` 第 31–34 行:`lookup-result` 仍会 `done`,`lookup-vocab` 仍在(词典命中时由 `addSource` 渲染),无需改;只把等待 `data-status="done"` 的 `timeout: 60_000` 保留。
- [ ] **Step 2:** `web/README.md` 的查词一节追加一段(只追加,与 A 的改动不相邻):「选中单词后底部是一排操作条:查词 · 朗读 · 加入词汇本。查词先问服务端本地词典(`POST /api/dictionary/lookup`,词只在请求体里,与 AI 共用限流),命中立即显示并标「词典」,可再点『AI 结合语境讲解』;未命中或词典出错自动改问大模型并标『AI 查询』。朗读在点击手势里调用(iOS 要求)。**未在真机验证:** iOS Safari 点『朗读』能否出声、360 px 宽度下操作条是否溢出。」
- [ ] **Step 3: 体积(如实报告数字):** 改动前后各跑一次 `yarn web:build`,然后 `cd web && node scripts/check-main-bundle.mjs --max-delta=1000`(只读取并打印 `main bundle: X kB gzip`,不要 `--record`,不改基线文件);把两次的数字写进本计划末尾的 `## Addendum(日期)`。预期增量很小:`dictionary.ts` / 操作条 / 朗读贡献都是 lookup 与 chat 的既有主包代码;词典结果组件没有新依赖。不要预先写数字。
- [ ] **Step 4:** 收尾验证(用户要求全量时才跑全量):`cd server && uv run pytest -q tests/test_dictionary_*.py tests/test_wordbook_forms_*.py tests/test_wordbook_definitions_*.py tests/test_architecture.py`;`yarn web:typecheck && yarn vitest run src/features/lookup src/features/chat/read-aloud-action.test.tsx src/plugins src/lib src/architecture.test.ts`。
- [ ] **Step 5: 提交** `docs(web): note the action bar and update the lookup e2e expectations`。

## 手动验证清单(未验证,由用户在真机 / 真环境勾选)

- [ ] iOS Safari:选中英文单词 → 操作条出现且选区不消失;点「朗读」立即出声(手势内调用);再点停止。
- [ ] 360 px 宽:英文界面下操作条三个按钮不溢出、不被底部导航遮挡;C 计划合并后(外壳固定)位置仍贴底。
- [ ] 词典命中显示中文 / 英文释义(随「释义显示」偏好)、音标、≤3 条短语;点「AI 结合语境讲解」只多一次 AI 请求。
- [ ] 生词(如 `went`)显示原形;未收录词走 AI 并标「AI 查询」。
- [ ] 部署后冷启动第一次多词查询约 3 秒(短语表一次性构建),之后即时(数字取自本机实测,见 Global Constraints)。

## 已知限制 / 不做

- 不做规则式词形还原兜底(R-L8):ECDICT 的比较级 / 最高级覆盖有限(`r`/`t` 共约 800 个原形),`bigger` 之类可能未命中而走 AI。需要时单独评估误判率后再加。
- 预取每次选词一次请求(共用 AI 的 60/分钟桶,R-L3);管理端可调大 `ai_rate_limit_per_minute`。
- 抽屉里没有朗读按钮(只在操作条);词典结果没有「中」小开关(只遵守 `def_lang`)。
- 词典不收录的词组 / 句子一律走 AI / 翻译;短语只在词书短语表精确命中才算命中。
