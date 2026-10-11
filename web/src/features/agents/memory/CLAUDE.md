# web/src/features/agents/memory/

记忆页(spec §8.4;计划 `docs/superpowers/plans/2026-10-12-agents-memory.md` W1–W5),路由 `/me/agents/memory`(`?tab=profile|items|recaps|manage`)。

## What lives here
- `memory-api.ts` 接口、类型、错误映射;`use-load.ts` 加载钩子;`ui.ts` 按钮类与格式化;`status.tsx` 加载 / 错误 / 空状态
- `memory-page.tsx` 外壳(分段控件 + 分区);`profile-tab.tsx`、`items-tab.tsx`、`recaps-tab.tsx`、`manage-tab.tsx`
- `lazy.tsx` 懒加载包装(唯一被 `../index.ts` 导出的组件)
- `locales.ts` + `locales/{zh-CN,en}.json`:键前缀 `web.agents.memory.*`,经 `registerAgentsLocales` 在懒加载块里并入(INDEX X11;不在主包 i18n glob 里)

## Allowed dependencies
`~/api`、`~/auth`、`~/components`、`~/layout`、`~/lib`、`@renderer/lib/utils`、`lucide-react`、`react-router-dom`、`react-i18next`。
**不导入 `features/agents/` 里 memory 以外的文件,唯一例外是 `../locales`(文案注册)**;agents 的其他文件只可导入 `memory/lazy` 与 `memory/memory-api`(`src/architecture.test.ts`)。

## Test
`cd web && yarn vitest run src/features/agents/memory src/architecture.test.ts`
契约:`memory-contract.test.ts` 读 `server/tests/fixtures/agents_memory_contract.json`(不存在时用 `test-fixtures.ts` 的样例)。

## Pitfalls
- 档案键是单词(R-M7):别加带下划线的键,否则 `editedKeys` 与 camelCase 后的 `profile` 对不上。
- 导出用 `as: "blob"` 原样下载,不要走 JSON 解析(会被 camelCase 改写)。
- 记忆文本永不进 URL / 日志 / toast;删除是永久的,文案明说。
- 清空必须两步:按钮只打开抽屉,抽屉里的红色按钮才发请求(测试守着)。
- 暂停开关写 A1 的 `PATCH /api/agents/settings`;服务端开关关闭时(`memoryAvailable=false`)仍允许查看、导出、删除。
- 颜色一色一义:置顶 / 选中蓝、建议与弱点琥珀、进步绿、红只给清空。
