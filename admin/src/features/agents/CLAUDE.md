# admin/src/features/agents/

## What lives here
管理后台「智能体」页 `/admin/agents`(spec 2026-10-12-agents §10.2;桌面 ≥ 1024px):`api.ts`(`/api/admin/agents*`,snake → camel;
角色查询用 POST)、`strings.ts`(zh-CN,也给 `components/layout.tsx` 的导航项用)、`agents-page.tsx`(开关、工具方式与探测、
今日与 7 天计数、举报、自建角色列表)、`persona-dialog.tsx`(人设原文:viewer 只读,operator 可改名称 / 简介 / 人设 + 理由)、
`agent-icon.tsx`(导航图标)、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature(`camel` 复制了一份)。
`components/layout.tsx` 只导入这里的 `strings.ts` 与 `agent-icon.tsx`。

## Test
`cd admin && yarn vitest run src/features/agents`(fetch 打桩,角色用 `session.setSession`)。

## Pitfalls
- 开关只显示不修改:改开关去「设置 → 智能体」(唯一写入路径 settings_service,含危险确认与审计)。
- 人设原文只用于审核:不要在列表里铺开显示,只在对话框里;不要加「导出」。
- 计数是数字,没有任何对话或记忆内容;探测结果每进程一份,重启后显示「未运行」。
- 搜索词走 POST 体,不要改成查询参数(访问日志会记录 URL)。
