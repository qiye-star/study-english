import { describe, expect, it } from "vitest";
import type { ApiClient } from "~/api/client";
import { createExtensionRegistry, PROMPT_HINT_MAX } from "./extension-points";

const api = {} as ApiClient;

describe("prompt hints (plan L4 Task 16)", () => {
  it("with nothing registered the answer is empty", async () => {
    expect(await createExtensionRegistry().collectPromptHints(api)).toEqual([]);
  });

  it("returns each loader's block, trimmed, in registration order", async () => {
    const r = createExtensionRegistry();
    r.contributePromptHint({ id: "a", load: async () => "  first block  " });
    r.contributePromptHint({ id: "b", load: async () => "second" });
    expect(await r.collectPromptHints(api)).toEqual(["first block", "second"]);
  });

  it("drops null, blank and failing loaders; one broken loader never hides the others", async () => {
    const r = createExtensionRegistry();
    r.contributePromptHint({ id: "none", load: async () => null });
    r.contributePromptHint({ id: "blank", load: async () => "   " });
    r.contributePromptHint({ id: "boom", load: async () => { throw new Error("upstream"); } });
    r.contributePromptHint({ id: "ok", load: async () => "kept" });
    expect(await r.collectPromptHints(api)).toEqual(["kept"]);
  });

  it("a loader that never answers is cut off at the timeout, and its signal is aborted", async () => {
    const r = createExtensionRegistry();
    let aborted = false;
    r.contributePromptHint({
      id: "slow",
      load: (_api, signal) => new Promise<string | null>(() => {
        signal.addEventListener("abort", () => { aborted = true; });
      }),
    });
    expect(await r.collectPromptHints(api, 20)).toEqual([]);
    expect(aborted).toBe(true);
  });

  it("caps each block at the maximum length", async () => {
    const r = createExtensionRegistry();
    r.contributePromptHint({ id: "long", load: async () => "x".repeat(PROMPT_HINT_MAX + 50) });
    const [block] = await r.collectPromptHints(api);
    expect(block).toHaveLength(PROMPT_HINT_MAX);
  });

  it("refuses a duplicate id", () => {
    const r = createExtensionRegistry();
    r.contributePromptHint({ id: "dup", load: async () => null });
    expect(() => r.contributePromptHint({ id: "dup", load: async () => null })).toThrow(/duplicate prompt hint dup/);
  });
});
