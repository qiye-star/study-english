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

export function lastAssistantText(messages: UiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].status === "done") return messages[i].content;
  }
  return "";
}
