import type { ReactNode, RefObject } from "react";
import type { Persona } from "~/features/agents";
import type { Conversation, ConversationConfig } from "./chat-api";
import type { chatOptions } from "./chat-request";
import type { OptionToggles } from "./options-rows";
import type { UiMessage } from "./ui-message";

/** 通话入口的状态(与旧顶栏的 gating 完全相同;`callButtonRef` 让页面在通话结束后把焦点还给按钮)。 */
export interface ChromeCallState {
  canCall: boolean;
  callDisabled: boolean;
  callBlockedReason?: string;
  callButtonRef: RefObject<HTMLButtonElement | null>;
}

/** 页面正忙的各种原因(角色选择、输入等据此禁用)。 */
export interface ChromeBusy {
  sending: boolean;
  voiceBusy: boolean;
  call: boolean;
  settling: boolean;
  tutor: boolean;
  /** 任一为真(旧角色芯片的 disabled 条件) */
  any: boolean;
}

/** 对话页已有能力的句柄,外框(顶栏、设置面板……)只读使用。 */
export interface ChromeCtl {
  conversation: Conversation | null;
  config: ConversationConfig;
  options: ReturnType<typeof chatOptions>;
  personaName: string | null;
  saveSettings(changes: Partial<ConversationConfig>): Promise<void>;
  /** 「双语 / 自动朗读」行的状态(自动朗读含乐观值),交给 `OptionRows` */
  toggles: OptionToggles;
  toggleBilingual(): void;
  toggleAutoSpeak(): void;
  openSettings(): void;
  openRecap(): void;
  startCall(): void;
  callState: ChromeCallState;
  choosePersona(persona: Persona | null): void;
  /** 角色解析结果回传(助手头像取角色名首字);带角色选择器的外框必须调用 */
  reportPersona(persona: Persona | null): void;
  /** 智能体已关闭(角色选择器发现的);页面据此显示「切回普通对话」 */
  reportAgentsOff(off: boolean): void;
  busy: ChromeBusy;
}

/**
 * 对话页的外框插槽。缺省 = `CLASSIC_CHROME`(返回按钮 + 角色芯片 + 「调整」面板),
 * 页面行为与 DOM 一字不变。新对话主页(features/chat/home)传入自己的实现。
 */
export interface ConversationChrome {
  renderLeading(ctl: ChromeCtl): ReactNode;
  renderActions(ctl: ChromeCtl): ReactNode;
  /** 缺省:对话名 + 场景 / 音色副标题(液态皮肤下副标题在列表顶部) */
  renderTitle?(ctl: ChromeCtl): { title: ReactNode; subtitle?: ReactNode };
  /** 消息列表里、第一条消息之前 */
  beforeMessages?(ctl: ChromeCtl): ReactNode;
  /** 包装一条消息的默认气泡(例如问候组);返回 `defaultNode` 即不变 */
  renderMessage?(message: UiMessage, defaultNode: ReactNode, ctl: ChromeCtl): ReactNode;
  /** 会话已加载且没有消息时 */
  emptyState?(ctl: ChromeCtl): ReactNode;
  /** 会话(重新)加载到某个 id 时 */
  onLoaded?(conversation: Conversation): void;
}
