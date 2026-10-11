# web/src/features/agents/

智能体(角色)的网页外壳:SSE 回合客户端、过程胶囊/卡、来源标签、角色 chip/选择/编辑/举报、设置页 `/me/agents`。
Spec: `docs/superpowers/specs/2026-10-12-agents-design.md`;计划 `docs/superpowers/plans/2026-10-12-agents-web.md`(A4)。
契约样例:`server/tests/fixtures/agents_contract.json`(`agents-contract.test.ts` 逐键核对)。

## What lives here
- `types.ts`(线上形状,camelCase)、`agents-api.ts`(REST + `normalizeConfig`)、`use-agents-data.ts`(config / settings / personas 缓存钩子)
- `sse.ts`(自己的 SSE 解析器,保留 event 名)、`trace.ts`(`normalizeTrace`、实时过程归并)、`step-labels.ts`
- `turn-stream.ts`(`streamAgentTurn`,懒加载块)、`use-agent-turn.ts`(`runAgentTurn` 动态导入垫片 + `useAgentTurn`)
- `locales.ts` + `locales/{en,zh-CN}.json`(懒加载文案,不在主包的 `**/i18n/*.json` glob 里)
- `lazy-parts.tsx`(`part()` 懒加载包装;每个组件一行 `export const X = part(...)`)

- `memory/` 记忆页(档案 / 长期 / 回顾 / 管理,`/me/agents/memory`;见 `memory/CLAUDE.md`)。**自包含**:只可导入本 feature 的 `locales.ts`
  (注册 `web.agents.memory.*` 文案);本 feature 的其他文件只可导入 `memory/lazy` 与 `memory/memory-api`(`src/architecture.test.ts`)。

## Public surface
见 `index.ts`:类型、`agentsApi`、`runAgentTurn`、`useAgentTurn`、`normalizeTrace`,组件一律是 `lazy-parts` 的懒包装。
文案注册入口:`registerAgentsLocales({ en, "zh-CN" })`(`locales.ts`,供 memory/、tutor/ 在自己的懒加载块里并入 `web.agents.*`)。

## Allowed dependencies
`lib/`、`api/`、`components/`、`auth/`、`settings/`、`i18n/`、`@renderer/*`。不导入任何别的 feature(包括 chat)。

## Bundle
agents 全部懒加载;主包净增量预算 ≤ 0.2 kB gzip(`yarn web:build && cd web && node scripts/check-main-bundle.mjs`,基线 `scripts/main-bundle-baseline.json`)。

## Test
`cd web && yarn vitest run src/features/agents src/architecture.test.ts`

## Pitfalls
- SSE:不用 `EventSource`(只能 GET、鉴权会进 URL);读流用 `getReader()`,不用 `for await` / `TextDecoderStream`(iOS Safari)。从不自动重试(R-W10)。
- URL / 日志 / 错误对象里不放文本、词、令牌;`AgentTurnError.message` 只含错误码。
- 文案键一律 `web.agents.*`;服务端步骤标签 `agents.step.<key>` 映射到 `web.agents.step.<key>`,未知键回落 `web.agents.step.unknown`。
- 一色一义:蓝 = 操作/进行中,青 = 词汇与查词工具,琥珀 = 读个人数据 / 仅你可见,绿 = 完成,红 = 失败(跳过是中性)。
