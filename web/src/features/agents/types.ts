/**
 * agents 的线上形状(spec 2026-10-12-agents §4.2–§4.4)。ApiClient 把响应键深度转成 camelCase、请求体键转回 snake_case,
 * 所以这里一律 camelCase;值(如工具键 "learned_words")不受影响。字段名以 A1 录制的 agents_contract.json 为准
 * (agents-contract.test.ts 逐键核对)。SSE 不经 ApiClient,由 sse.ts 自己转 camelCase。
 */
export const TOOL_KEYS = ["lookup", "learned_words", "weak_words", "due_words", "memory"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];
/** 用户设置里 tools 是对象,它的键会被 camelCase:两种写法用这张表对应。 */
export const TOOL_FIELD = {
  lookup: "lookup", learned_words: "learnedWords", weak_words: "weakWords", due_words: "dueWords", memory: "memory",
} as const satisfies Record<ToolKey, string>;
export type ToolField = (typeof TOOL_FIELD)[ToolKey];

export const PERSONA_LEVELS = ["A2", "B1", "B2", "C1"] as const;
export type PersonaLevel = (typeof PERSONA_LEVELS)[number];
export const PERSONA_STYLES = ["friendly", "strict", "humor", "concise"] as const;
export type PersonaStyle = (typeof PERSONA_STYLES)[number];
export const TUTOR_KINDS = ["ask", "words", "repeat", "retell", "roleplay", "dictate"] as const;
export type TutorKind = (typeof TUTOR_KINDS)[number];

export interface Persona {
  id: string;
  /** 内置角色(id 以 builtin: 开头) */
  builtin: boolean;
  /** 本人创建 */
  mine: boolean;
  name: string;
  intro: string;
  /** 人设原文:内置、本人、或 promptPublic 时才有;否则 null(D3) */
  prompt: string | null;
  level: PersonaLevel;
  style: PersonaStyle;
  voice: string | null;
  tools: ToolKey[];
  promptPublic: boolean;
  deepThink: boolean;
  /** 管理员停用(spec §9.1):使用处显示「已停用」 */
  disabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}
export type PersonaDraft = Pick<Persona, "name" | "intro" | "level" | "style" | "voice" | "tools" | "promptPublic" | "deepThink"> & { prompt: string };
export const isBuiltin = (p: Pick<Persona, "id">): boolean => p.id.startsWith("builtin:");

export interface AgentSettings {
  tools: Record<ToolField, boolean>;
  memoryEnabled: boolean;
  shareInRooms: boolean;
  showProcess: boolean;
  defaultPersonaId: string | null;
  tutor: { length: number; mix: TutorKind[] };
  /** 服务端固定 "collapsed"(D1);前端只读 */
  processDefault: string;
}
export type AgentSettingsPatch = Partial<Omit<AgentSettings, "tools" | "tutor" | "processDefault">> & {
  tools?: Partial<Record<ToolField, boolean>>;
  tutor?: Partial<AgentSettings["tutor"]>;
};

/** `GET /api/agents/config` 的线上形状(已 camelCase);关闭时只有 { enabled: false }。 */
export interface AgentsConfigWire {
  enabled: boolean;
  available?: boolean;
  tutor?: boolean;
  memory?: boolean;
  rooms?: boolean;
  toolsMode?: string;
  limits?: { personasMax: number; promptMaxChars: number; historyMax: number; textMaxChars: number };
  levels?: PersonaLevel[];
  styles?: PersonaStyle[];
  tools?: ToolKey[];
}
/** 前端使用的扁平形状(agentsApi.config 由 AgentsConfigWire 归一化得到)。 */
export interface AgentsConfig {
  enabled: boolean;
  /** 服务端有可用的 LLM */
  available: boolean;
  tutorEnabled: boolean;
  memoryEnabled: boolean;
  roomsEnabled: boolean;
  promptMaxChars: number;
  personasMax: number;
  historyMax: number;
  textMaxChars: number;
}
export const AGENTS_DISABLED: AgentsConfig = Object.freeze({
  enabled: false, available: false, tutorEnabled: false, memoryEnabled: false, roomsEnabled: false,
  promptMaxChars: 800, personasMax: 10, historyMax: 20, textMaxChars: 2000,
});

export type StepGroup = "context" | "tool";
export type StepStatus = "run" | "done" | "fail" | "skip";
export interface AgentStep {
  id: string;
  group: StepGroup;
  /** persona | memory | history | learned_words | weak_words | due_words | word_lookup(spec §4.6) */
  key: string;
  status: StepStatus;
  /** 服务端的 `agents.step.<key>`;界面按 key 取 `web.agents.step.<key>`,不直接显示 */
  labelKey: string;
  /** 只允许词本身与计数(spec §4.4) */
  params?: Record<string, string | number>;
  ms?: number;
  private: boolean;
}
export interface AgentThought {
  source: "summary" | "reasoning";
  text: string;
}
export interface TurnMeta {
  stepIndex: number;
  stepsTotal: number;
  verdict?: "good" | "ok" | "weak" | "skip";
  kind?: TutorKind;
  done?: boolean;
}
/** 界面用的压缩过程(done.trace / messages.agent_trace 经 normalizeTrace 归一;ms = 总耗时毫秒)。 */
export interface AgentTrace {
  v: number;
  ms: number;
  steps: AgentStep[];
  thought: AgentThought | null;
}
export type TurnErrorCode = "disabled" | "limit" | "llm_unavailable" | "bad_request" | "busy";
export type TurnEvent =
  | { type: "start"; turnId: string }
  | { type: "step"; step: AgentStep }
  | { type: "thought"; thought: AgentThought }
  | { type: "delta"; text: string }
  | { type: "meta"; meta: TurnMeta }
  | { type: "done"; usage: { in: number; out: number } | null; trace: AgentTrace | null; textLen: number }
  | { type: "error"; code: TurnErrorCode };

/** 生成中的过程(界面状态);startedAt 是客户端毫秒时间。 */
export interface LiveTrace {
  turnId: string | null;
  startedAt: number;
  steps: AgentStep[];
  thought: AgentThought | null;
  meta: TurnMeta | null;
  phase: "prep" | "streaming" | "done" | "error";
}
export interface AgentTurnRequest {
  personaId: string;
  conversationId: string;
  /** null 仅用于导师模式的开场 / 继续 */
  text: string | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: "chat" | "tutor";
  tutorSessionId: string | null;
  /** 不传则生成新的;重试时按 R-W10 传入上一次错误的 retryId */
  clientTurnId?: string;
}
export interface AgentTurnResult {
  text: string;
  trace: AgentTrace | null;
  turnId: string | null;
  meta: TurnMeta | null;
  clientTurnId: string;
}
/** 对话气泡上的智能体状态:生成中 live、完成后 trace、失败后可沿用的 retryId。 */
export interface AgentView {
  live?: LiveTrace | null;
  trace?: AgentTrace | null;
  retryId?: string;
}
