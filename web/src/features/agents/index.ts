// agents 的公共接口:其他目录只能从这里引入 agents(由 src/architecture.test.ts 约束)。
// 子 feature(memory/、tutor/)只追加导出,不删已有内容(INDEX X10)。
// ---- A4 agents-web ----
// 组件一律从 lazy-parts 导出懒加载包装(R-W2);类型导出在编译后消失。
export type {
  AgentSettings, AgentStep, AgentThought, AgentTrace, AgentTurnRequest, AgentTurnResult, AgentView, AgentsConfig, LiveTrace,
  Persona, PersonaDraft, ToolKey, TurnEvent, TurnMeta,
} from "./types";
export { agentsApi } from "./agents-api";
export { normalizeTrace } from "./trace";
export { runAgentTurn, useAgentTurn } from "./use-agent-turn";
