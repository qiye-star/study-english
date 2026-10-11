# app/links/

学习联动(spec `docs/superpowers/specs/2026-10-11-learning-links-design.md`)。顶层:订阅核心学习事件、实现六个联动。
Off unless `LINKS_ENABLED`(每个联动另有 `LINK_<KEY>_ENABLED` 与每用户开关)。

## What lives here
- `spec.py`(LinkSpec、LINK_KEYS、flag_of、WordIn)、`gate.py`(三级开关 + 30 秒偏好缓存、`require_link`)、`prefs.py`、
  `registry.py`(LINKS:删一行 = 删一个联动)、`setup.py`(install、config_out)、`purge.py`(保留期清理)、
  `admin_view.py`(管理端视图,LA 车道)
- 联动:`word_actions.py`(`POST /wordbook/adopt`、`POST /wordbook/card`,无订阅)、`daily_tasks.py`(`GET /today`,无订阅)、
  `mistakes.py`(`WordAnswered`;`GET /mistakes`、`POST /mistakes/dismiss`)、`pron_shadow.py`(`AssessmentFinished`;
  `GET /weak-words`、`POST /weak-words/dismiss`、`GET /today-words`)、`chat_words.py`(`MessageSent`、段位来源 `word_in_chat`、
  可选 `JudgeRunner`;`GET /chat-words`)、`rank_sources.py`(只是 gate 键,无订阅无接口)

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`、`app.rank`、`app.rooms`、`app.wordbook`。
只有 `app/routers/` 与 `app/main.py` 可以导入本包(`tests/test_architecture.py::test_links_is_a_top_layer`)。
段位经 `app.models.LinkCredit` 读来源,不导入本包。

## Link module contract
- `SPEC = LinkSpec(key, label_zh, label_en, install=None, router=None)`。
- `install(app, bus)`:`bus.subscribe(EventType, "<key>", functools.partial(handle, app))`;登记段位来源用
  `app.core.rank_sources.register(...)`(同内容重复登记是空操作)。
- `router`:`APIRouter()`,路径相对 `/api/links`(如 `"/mistakes"`);依赖 `require_link("<key>")`(写接口 `limited=True`),
  无效时 404 `Link is off`。错误一律 `{"error": ...}`。

## Handler contract(spec §4.5)
`async def handle(app, event)`;自己开会话、自己提交;幂等;≤ 6 次往返、单查询 ≤ 200 行;不发上游请求(chat_words 的 JudgeRunner 除外);
不判断开关(gate 统一,在调用处理器之前);日志不含词、文本、用户输入、用户 id。

## Tests
`uv run pytest -q tests/test_links_*.py tests/test_learning_events.py tests/test_rank_sources.py tests/test_rank_extra_sources.py tests/test_admin_links.py`
(`test_links_matrix.py` 全关 / 全开 / 只开一个逐值对照;`test_links_privacy.py` 检查每个路由的 URL 与日志里没有词、文本、用户 id。)
助手:`tests/links_helpers.py`(`enable_links`、`drain`、`check_contract`、`user_id_of`)。测试不跑 lifespan:发布后 `await drain(app)`。

## Pitfalls
- 发布语句只在发布方 `commit()` 之后;本包从不调用 `publish`。
- `MessageSent.text` 只在内存;不要把它写进表、日志、异常或管理端错误。
- 通道的 gate(`setup.install`)只对 registry 里的联动键做三级判断;其他订阅名(测试记录器)只受总开关约束。
  订阅时的联动名必须与 `SPEC.key` 完全一致,否则开关不生效。
- 偏好缓存每进程 30 秒;`PUT /api/links/prefs` 只失效本进程(多进程下其他进程最多 30 秒后生效)。
- 事件通道每进程一条、进程重启丢未处理事件:处理器必须幂等,关键积分读源表。
- 新联动:加模块 + registry 一行 + `Settings` 开关 + 注册表 spec + 网页插件;改 spec 先。
- 词、文本、用户 id 永远不进 URL(uvicorn 访问日志会记录路径与查询串):只读查询也用 POST + JSON 体(见 `word_actions.card`);
  查询参数只允许 `page`、`offset`,路径参数不允许(`test_links_privacy.py`)。
- 段位来源注册表是进程级的:`chat_words.install` 在每次 `create_app` 时登记 `word_in_chat`;要空注册表的测试在应用建好之后再清空。
- 删除用户:新表若有指向 `users.id` 的外键,把它加进 `app/admin/users_admin.USER_ROWS`(或 `USER_REFS_NULLED`),否则测试失败。
