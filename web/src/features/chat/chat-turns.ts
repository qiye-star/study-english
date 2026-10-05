import type { UiMessage } from "./ui-message";

/**
 * 规则(沿用对话页既有约定):失败的一轮从未保存,发送新消息时丢弃它。
 * 失败的回复连同它的用户消息一起丢弃;未发送的语音草稿(转写失败/保留待发送)只有一条。
 */
export function dropFailedTail(messages: UiMessage[]): { kept: UiMessage[]; dropped: UiMessage[] } {
  const last = messages[messages.length - 1];
  if (!last || last.status !== "error") return { kept: messages, dropped: [] };
  const n = last.role === "assistant" ? 2 : 1;
  return { kept: messages.slice(0, -n), dropped: messages.slice(-n) };
}

/**
 * 连续丢弃末尾所有失败的内容:被 held 的语音草稿(错误态的用户气泡)后面可能还跟着
 * 上一轮失败的"用户消息 + 错误气泡",两者都从未保存,新的发送必须一并丢弃,
 * 否则历史里会出现两条连续的用户消息、失败的一对留在界面上。
 */
export function dropFailedTails(messages: UiMessage[]): { kept: UiMessage[]; dropped: UiMessage[] } {
  let kept = messages;
  let dropped: UiMessage[] = [];
  for (;;) {
    const step = dropFailedTail(kept);
    if (!step.dropped.length) return { kept, dropped };
    kept = step.kept;
    dropped = [...step.dropped, ...dropped];
  }
}

export function lastAssistantText(messages: UiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].status === "done") return messages[i].content;
  }
  return "";
}
