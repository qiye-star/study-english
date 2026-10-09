# admin — 管理后台前端

React 18 + react-router 7 + Tailwind 3 + vitest,独立的 Yarn 工作区(与 `web/` 零代码共享)。由 `server/` 托管在 `/admin`,
API 全部在 `/api/admin/*`。运维说明(角色、Cookie/HTTPS、加密主密钥、安全模式与应急命令、维护模式、单价表、备份)见
`server/README.md`「管理端」「管理后台 v2」;规格 `docs/superpowers/specs/2026-10-09-admin-console-v2-design.md`。

## 命令

```bash
yarn admin:dev                      # http://localhost:5174,/api 代理到 ADMIN_DEV_API_TARGET(默认 http://127.0.0.1:8000)
yarn workspace admin typecheck
yarn workspace admin test           # vitest + Testing Library(jsdom)
yarn workspace admin build          # 产物 admin/dist,Docker 镜像里由 server 托管(ADMIN_DIST_DIR)
```

本地联调:后端 `ADMIN_USERNAME` / `ADMIN_PASSWORD`(≥ 12 位)启用管理端,**本地 http 需 `ADMIN_COOKIE_SECURE=false`**
(默认的 `__Host-` Secure Cookie 只在 HTTPS 下保存)。

## 结构

- `src/app.tsx`:路由;`RequireAuth` 首次进入调用 `GET /api/admin/session`。
- `src/api/`:`client.ts`(Cookie 会话 + `X-Admin-CSRF`,403 `Step-up required` 时弹二次验证并重放原请求;`ApiError(status, message, fields, details)`)、
  `session.ts`(内存里的会话与 CSRF,不进 sessionStorage)、`endpoints.ts`(登录与 v1 只读接口)。
- `src/components/`:外壳 `layout.tsx`(侧栏 `NAV`,每项声明最低角色;`< 1024px` 整页提示「请使用桌面浏览器访问管理后台」)、
  `Dialog` / `ConfirmDialog`(理由、输入确认)/ 二次验证 / `DiffTable` / `SecretField` / `ApplyBadge` / `RoleGate` / `DataTable` / `BarChart`。
- `src/features/<area>/`:按功能分目录,每个目录有 `index.ts`(对外出口,`app.tsx` 只从这里导入)、`api.ts`(该功能的接口与
  snake_case → camelCase 转换)、`strings.ts`(全部中文文案)、页面与测试。

| 目录 | 页面 | 最低角色(侧栏) |
|---|---|---|
| `settings` | 运行时设置、功能开关、配置诊断、测试连接、历史/撤销、导入导出 | viewer(写:superadmin) |
| `security` | 管理员与会话(自己的会话、TOTP、密码;账号表仅超级管理员) | viewer |
| `audit` | 审计日志、差异、哈希链校验 | viewer(只看自己的;校验:operator) |
| `rank` | 段位总览、段位规则编辑器(草稿/校验/预演/发布)、比赛审计、用户段位面板 | viewer |
| `users` | 用户「治理」页签(停用、撤销登录、重置密码、删除、配额覆盖)、邀请码 | viewer / operator |
| `rooms` | 房间列表与详情(时间线、移出、隐藏消息、关闭 AI)、举报 | viewer / operator |
| `usage` | 用量与估算费用、错误分布、上游健康(超级管理员可逐行测试连接) | viewer |
| `ops` | 系统状态、脱敏日志、公告与维护、数据与备份 | viewer / operator / superadmin |
| `prompts` | 提示词版本(语法规则、房间助手、`@ai`、情景模板):草稿、检查清单、对比、试运行、发布 | viewer |

## 约定

- 只做桌面(≥ 1024px,Addendum R-7);不引入 UI/图表/状态库;数字用 `tabular-nums`;颜色一色一义(蓝 = 主操作/进度,
  绿 = 健康/生效,琥珀 = 待重启/提醒,红 = 危险/错误)。
- 界面按角色隐藏只是体验,权限以服务端为准(每个 `/api/admin/*` 端点声明最低角色,写操作要 CSRF,危险操作要二次验证 + 理由)。
- 密钥只显示「已设置 · 指纹」,从不回显;提示词正文、用户文本不进日志。
- 测试一律 mock `features/*/api.ts`(计划 P-7),不打真实网络;服务端契约由 `server/tests` 钉住。
- E2E:`web/e2e/admin-v2.spec.ts`(Playwright,需要 `E2E_ADMIN_PASSWORD`,见 `docs/superpowers/plans/e2e-results.md`)。
