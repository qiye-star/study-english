import { describe, expect, it } from "vitest";
import { REALTIME_PROMPT_MAX, capRealtimePrompt, withPromptHint } from "./chat-request";

describe("prompt hints in chat requests (plan L4 Task 16)", () => {
  it("without a hint the prompt is unchanged, character for character", () => {
    expect(withPromptHint("You are a tutor.\n\n  ", null)).toBe("You are a tutor.\n\n  ");
    expect(withPromptHint("base", "   ")).toBe("base");
  });

  it("a hint is appended after the base prompt as its own paragraph", () => {
    expect(withPromptHint("You are a tutor.", "Use talk naturally.")).toBe("You are a tutor.\n\nUse talk naturally.");
    expect(withPromptHint("", "Use talk naturally.")).toBe("Use talk naturally.");
  });

  it("the realtime prompt is cut to the server's code-point limit", () => {
    const long = "😀".repeat(REALTIME_PROMPT_MAX + 25);
    expect(Array.from(capRealtimePrompt(long))).toHaveLength(REALTIME_PROMPT_MAX);
    expect(capRealtimePrompt("short")).toBe("short");
    expect(REALTIME_PROMPT_MAX).toBe(8000);
  });
});
