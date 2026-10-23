import en from "./i18n/en.json";
import zh from "./i18n/zh-CN.json";
import { describe, expect, it } from "vitest";

/** 中英两份键一致;西语不做(计划 R19)。 */
function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)).sort();
}

describe("activation i18n", () => {
  it("has the same keys in English and Chinese", () => {
    expect(leaves(zh)).toEqual(leaves(en));
  });

  it("uses the web.activation namespace and the agent step label", () => {
    const keys = leaves(en);
    expect(keys.every((k) => k.startsWith("web.activation.") || k === "web.agents.step.dormant_words")).toBe(true);
    expect(keys).toContain("web.agents.step.dormant_words");
  });

  it("has no empty strings", () => {
    for (const key of leaves(en)) {
      const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en);
      expect(String(value).trim()).not.toBe("");
    }
  });
});
