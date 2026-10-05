import type { AssessmentScores, AssessmentWordBrief } from "~/features/practice/assessment-api";
import type { GrammarResult } from "~/features/grammar/grammar-types";
import type { ChatMessage } from "./chat-api";

export type ResultStatus = "pending" | "done" | "skipped" | "error";

export interface AssessmentView {
  status: ResultStatus;
  reason?: "non-english" | "too-long";
  scores?: AssessmentScores;
  words?: AssessmentWordBrief[];
}

export interface GrammarView {
  status: ResultStatus;
  result?: GrammarResult;
  /** status 为 error 时的原始错误;界面用 translateServerError(t, error, GRAMMAR_SERVER_ERRORS) 翻译 */
  error?: unknown;
}

/** transcribing:转写中;failed:转写失败(可重试/丢弃);kept:切后台等自动停止后保留待发送;sent:已作为消息发出 */
export type VoicePhase = "transcribing" | "failed" | "kept" | "sent";

export interface VoiceView {
  phase: VoicePhase;
  durationMs: number;
  /** 本次会话里录的 WAV 的 blob URL(刷新后改走带鉴权的评测音频接口) */
  audioUrl?: string;
  /** 失败原因或"已保留 N 秒"之类的说明 */
  note?: string;
}

export interface UiMessage {
  key: string;
  id?: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
  voice?: VoiceView;
  assessmentId?: string | null;
  assessment?: AssessmentView;
  grammar?: GrammarView;
}

export function fromServerMessage(m: ChatMessage): UiMessage {
  const ui: UiMessage = { key: m.id, id: m.id, role: m.role as "user" | "assistant", content: m.content, status: "done" };
  if (m.role !== "user") return ui;
  if (m.assessmentId) ui.assessmentId = m.assessmentId;
  if (m.assessment) ui.assessment = { status: "done", scores: m.assessment.scores, words: m.assessment.words };
  if (m.grammar) ui.grammar = { status: "done", result: m.grammar };
  return ui;
}

/** 本次会话录的语音,或刷新后仍关联着评测(有服务端录音)的用户消息(R19)。 */
export function isVoiceMessage(m: UiMessage): boolean {
  return m.role === "user" && (!!m.voice || !!m.assessmentId);
}

/** 用户消息页脚(评测/语法徽标)只在有内容可显示时渲染:有评测,或语法状态不是 skipped。 */
export function hasResultFooter(m: UiMessage): boolean {
  return !!m.assessment || (!!m.grammar && m.grammar.status !== "skipped");
}
