import { describe, expect, it } from "vitest";
import { dropFailedTail, lastAssistantText } from "./chat-turns";
import type { UiMessage } from "./ui-message";

const m = (key: string, role: "user" | "assistant", status: UiMessage["status"] = "done", extra: Partial<UiMessage> = {}): UiMessage =>
  ({ key, role, content: key, status, ...extra });

describe("chat turns", () => {
  it("drops a failed reply together with its user message", () => {
    const list = [m("u1", "user"), m("a1", "assistant"), m("u2", "user"), m("a2", "assistant", "error")];
    expect(dropFailedTail(list)).toEqual({ kept: list.slice(0, 2), dropped: list.slice(2) });
  });

  it("drops only an unsent voice draft", () => {
    const list = [m("u1", "user"), m("a1", "assistant"), m("v1", "user", "error", { voice: { phase: "failed", durationMs: 1000 } })];
    expect(dropFailedTail(list)).toEqual({ kept: list.slice(0, 2), dropped: list.slice(2) });
  });

  it("keeps a healthy tail", () => {
    const list = [m("u1", "user"), m("a1", "assistant")];
    expect(dropFailedTail(list)).toEqual({ kept: list, dropped: [] });
    expect(dropFailedTail([])).toEqual({ kept: [], dropped: [] });
  });

  it("finds the last finished assistant text", () => {
    expect(lastAssistantText([m("a0", "assistant"), m("u1", "user"), m("a1", "assistant", "error")])).toBe("a0");
    expect(lastAssistantText([])).toBe("");
  });

  it("only drops a lone failed assistant bubble without a preceding user message safely", () => {
    const list = [m("a1", "assistant", "error")];
    expect(dropFailedTail(list)).toEqual({ kept: [], dropped: list });
  });
});
