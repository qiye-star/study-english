# 管理端(Admin Console)实现计划

日期:2026-10-08 · 分支:`feat/self-hosted-backend`

## 目标与范围

给运营者一个只读的管理后台,挂在 `/admin`,可以查看**所有用户的全部内容**:账号、对话与聊天记录(含语法批注)、发音评测(分数、逐词结果)、**用户说出的录音(可回放)**、练习清单、词汇本、用量概览。

**不做(YAGNI):** 修改或删除用户数据、重置密码、多管理员与角色、操作审计 UI。需要时另开计划。

## 已确认的假设(需要用户确认)

| 项 | 取值 | 理由 |
|---|---|---|
| 管理员认证 | **环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD`**,登录后签发独立的短期 admin token(方案 A) | 不改 `users` 表、无迁移;和用户 token 体系隔离;未配置则整个管理端关闭 |
| 访问范围 | 只读 | 隐私风险最小 |
| 部署 | 仍是单个 server 镜像,同时托管 `web/dist` 和 `admin/dist` | 不新增容器或端口,沿用现有 compose |

> 隐私提示:管理端能看到所有用户的录音与对话。落地后需在 README 说明,并建议只经 HTTPS 访问。

## 架构

```
浏览器 /admin/**  ──▶ server routers/admin_web.py (托管 admin/dist,SPA 回退)
浏览器 fetch /api/admin/** ──▶ routers/admin.py (薄路由) ──▶ app/admin/service.py (查询) 
                                       └ Depends(admin_required) ──▶ app/admin/auth.py (token 签发与校验)
```

解耦原则:
- **前后端分离:** `admin/` 是独立 yarn workspace,与 `web/`、`enjoy/` 零代码共享(不 import `enjoy/src`、不 import `web/src`),只通过 HTTP 契约通信。
- **后端分层:** 路由只做参数与鉴权,查询放 `app/admin/service.py`,认证放 `app/admin/auth.py`。不动现有用户端路由,不复用用户端的 `owned_*` 校验(管理端查询不带 `user_id` 过滤)。
- **独立命名空间:** API 全部在 `/api/admin/*`,必须注册在 `stubs`(`/api/**` 兜底)之前;`/admin` 静态托管注册在 `web` 兜底之前。

## 目录

```
server/app/admin/__init__.py
server/app/admin/auth.py          # 校验账号、签发/校验 token、admin_required 依赖
server/app/admin/service.py       # 只读查询:用户/对话/评测/练习/词汇/概览(分页、搜索)
server/app/routers/admin.py       # /api/admin/*
server/app/routers/admin_web.py   # /admin 静态托管 + SPA 回退
server/tests/test_admin_auth.py
server/tests/test_admin_api.py
server/tests/test_admin_web.py
admin/                            # 新 workspace
  package.json  vite.config.ts  tsconfig.json  tailwind.config.cjs  postcss.config.cjs  index.html
  src/main.tsx  src/app.tsx
  src/api/{client.ts,types.ts,auth-storage.ts}   # fetch 封装、401 自动回登录、类型
  src/pages/{login,overview,users,user-detail,conversation,assessments}.tsx
  src/components/{layout,data-table,pagination,audio-player,score-badge,json-view}.tsx
  src/**/*.test.ts(x)
```

## 后端设计

### 配置(`config.py` + `server/.env.example`)
- `ADMIN_USERNAME=`、`ADMIN_PASSWORD=`:任一为空则管理端禁用(所有 `/api/admin/*` 返回 404,`/admin` 也 404)。
- `ADMIN_TOKEN_TTL_MINUTES=480`。
- `ADMIN_SESSION_SECRET=`:HMAC 密钥;留空则进程启动时随机生成(重启后需重新登录)。
- 启动校验:配置了管理员但 `ADMIN_PASSWORD` 少于 12 位则拒绝启动。

### 认证(`app/admin/auth.py`)
- `POST /api/admin/login {username, password}` → `{token, expires_at}`。用 `hmac.compare_digest` 比较,复用 `app.state.limiter` 按 IP 限流(`auth_rate_limit`);失败统一 401,不区分账号或密码错误。
- token = `base64url(payload).hmac_sha256(payload)`,payload 含 `exp` 和固定标记 `typ=admin`;无状态,不入库。用户 token 不能通过 admin 校验,反之亦然。
- `admin_required` 依赖:读 `Authorization: Bearer`,校验签名和过期,失败 401。

### API(全部只读,`GET`)
| 路径 | 说明 |
|---|---|
| `/api/admin/overview` | 用户总数、对话/消息/评测/录音数、录音总字节、近 N 天活跃用户与新增趋势 |
| `/api/admin/users?q=&page=&per_page=` | 用户列表(id、用户名、注册时间、各类计数、录音占用、最近活跃);`q` 按用户名/ID 搜索 |
| `/api/admin/users/{id}` | 用户详情与汇总,含语法规则自定义内容 |
| `/api/admin/users/{id}/conversations` | 该用户对话列表(名称、消息数、更新时间) |
| `/api/admin/conversations/{id}/messages` | 完整聊天记录:role、content、语法批注、关联评测摘要 |
| `/api/admin/users/{id}/assessments?source=` | 评测列表(参考文本、分数、时长、来源 practice/chat) |
| `/api/admin/assessments/{id}` | 评测详情,含逐词 `result` |
| `/api/admin/assessments/{id}/audio` | 录音回放(`audio/wav`,`Cache-Control: private, no-store`),路径解析复用 `recordings.absolute_path` 做目录逃逸防护 |
| `/api/admin/users/{id}/practice-items`、`/vocabulary` | 练习清单与词汇本(含复习进度) |

约定:分页形状与现有 `/api/assessments` 一致(`page`、`per_page`≤50、`next`);时间统一 `iso_utc`;`id` 路径参数 `max_length=64`;用户不存在 404。N+1 用聚合子查询避免;排序用 `(created_at desc, id desc)`。

### 托管(`routers/admin_web.py`)
- `admin_dist_dir` 配置 `ADMIN_DIST_DIR`,默认 `<仓库根>/admin/dist`(镜像内 `/admin/dist`)。
- 复用 `web.py` 的路径逃逸防护与缓存策略(`assets/*` immutable,其余 no-cache);`/admin` 和 `/admin/` 都返回 `index.html`;未构建返回 404。
- 管理端禁用时整体 404。注册顺序:`... realtime, admin, stubs, admin_web, web`。

## 前端设计(`admin/`)

- 技术栈:Vite + React 18 + react-router(`basename="/admin"`)+ Tailwind,与 `web/` 版本对齐;不引入 `enjoy` 的 UI shim。
- `vite.config.ts`:`base: "/admin/"`,dev 代理 `/api` 到 `ADMIN_DEV_API_TARGET`(默认 `http://127.0.0.1:8000`),端口 5174,避免和 `web` 冲突。
- `api/client.ts`:唯一出口,带 `Authorization: Bearer <admin token>`;401 时清 token 并跳登录;token 存 `sessionStorage`(关标签页即失效)。录音播放因 `<audio>` 不能带请求头,用 fetch 取 blob 再 `URL.createObjectURL`。
- 页面:
  - **登录**:账号密码。
  - **概览**:统计卡片 + 近 30 天新增/活跃折线(chart.js 已在 web 用过,这里独立依赖)。
  - **用户列表**:搜索、分页、点击进详情。
  - **用户详情**:页签「对话 / 评测与录音 / 练习清单 / 词汇本」。
  - **对话详情**:气泡式聊天记录,语法批注高亮,消息带评测时展示分数徽章与录音播放器。
  - **评测详情**:总分、逐词/音素表、录音波形或播放器、原始 JSON 折叠查看。
- 状态:每页自己的数据 hook(加载/错误/空状态),无全局 store。

## 部署

- 根 `package.json` workspaces 加入 `admin`,脚本 `admin:dev`、`admin:build`、`admin:test`。
- `server/Dockerfile`:`web` 构建阶段旁新增 `admin` 阶段(只复制 `admin/package.json` 做 `yarn workspaces focus admin`,再复制 `admin/`),最终镜像 `COPY --from=admin /repo/admin/dist /admin/dist`。注意 `yarn workspaces focus` 需要所有 workspace 的 `package.json` 都存在,Dockerfile 里补 `COPY admin/package.json`。
- `Dockerfile.dockerignore` 放行 `!admin`,忽略 `admin/node_modules`、`admin/dist`。
- `docker-compose.yml` 不用改;反向代理(1panel)把 `/admin` 和 `/api/admin` 与现有站点一同转发即可。
- 文档:更新 `server/README.md` 接口一览与「管理端」小节,`server/.env.example` 增加 ADMIN_* 配置并注明隐私与 HTTPS 要求。

## 任务拆分(TDD,每步独立提交)

1. **配置与认证** — 测试先行:配置缺省即禁用、登录成功/失败/限流、token 过期/篡改/拿用户 token 被拒。实现 `config.py`、`admin/auth.py`、`POST /api/admin/login`、`admin_required`。
2. **查询服务与只读 API** — 用 `conftest` 现有夹具造多用户数据,测:跨用户可见、分页、搜索、404、未带 token 401、普通用户 token 403/401。实现 `admin/service.py` 与 `routers/admin.py`,接入 `main.py`(顺序见上)。
3. **录音回放** — 测:200 返回 wav、文件缺失 404、路径逃逸 404、需 admin token。
4. **静态托管** — 测:`/admin`、深链、`assets/*` 缓存头、路径逃逸、未构建 404、禁用 404,且不影响 `web` 的回退。
5. **admin 前端骨架** — workspace、vite/tailwind/ts 配置、`api/client`(含 401 处理)、登录页、路由守卫,vitest 覆盖 client 与守卫。
6. **前端页面** — 概览、用户列表、用户详情、对话详情、评测详情与录音播放,组件测试覆盖空/错误/分页。
7. **Docker 与文档** — Dockerfile、dockerignore、README、.env.example;本地 `docker build` 验证 `/admin` 可访问。
8. **端到端冒烟** — 启动后端造数据,用浏览器登录、浏览用户、回放一条录音;跑 `server` 全量 pytest、`admin` typecheck/test,并确认 `web` 测试不受影响。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 管理员密码被暴力破解 | IP 限流、强制 ≥12 位、统一 401;建议反代再加 IP 白名单 |
| 管理端可访问全部隐私数据 | 默认关闭;只读;token 短期;README 明示 |
| `/api/**` 兜底路由吞掉 admin 路由 | 注册顺序测试(`test_admin_api` 断言未鉴权返回 401 而非 `{}`) |
| 录音路径逃逸 | 统一走 `recordings.absolute_path`,加测试 |
| 大数据量列表慢 | 分页 + 聚合子查询;`messages(conversation_id)`、`assessments(user_id)` 已有索引,无需迁移 |
| Dockerfile 里 yarn workspace 缺 package.json 构建失败 | 任务 7 本地实际 `docker build` 验证 |

## 待确认

1. 认证方案是否按 **A(环境变量账号)**?
2. 是否接受**严格只读**(不含删除用户或录音)?
3. 前端是否独立依赖、不复用 `web` 的 UI 组件(计划默认独立,代价是少量重复样式)?
