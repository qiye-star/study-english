import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureAgentsI18n, registerAgentsLocales } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

describe("agents locales (R-W3: lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.agents", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.agents."))).toBe(true);
  });

  it("merges into i18next once loaded", () => {
    ensureAgentsI18n();
    expect(i18n.getFixedT("zh-CN")("web.agents.process.summary", { seconds: 4 })).toBe("思考 4 秒");
    expect(i18n.getFixedT("en")("web.agents.process.toolsUsed", { count: 2 })).toBe("used 2 tools");
  });

  it("lets sub-features register their own bundles without overwriting existing keys (INDEX X11)", () => {
    registerAgentsLocales({
      en: { web: { agents: { memory: { title: "Memory page" }, tutor: { entry: "Overwritten?" } } } },
      "zh-CN": { web: { agents: { memory: { title: "记忆页" } } } },
    });
    expect(i18n.getFixedT("en")("web.agents.memory.title")).toBe("Memory page");
    expect(i18n.getFixedT("zh-CN")("web.agents.memory.title")).toBe("记忆页");
    expect(i18n.getFixedT("zh-CN")("web.agents.tutor.entry")).toBe("带我学");
  });

  it("keeps the one-line English labels short enough for a 360 px row (Z2 checks the real layout)", () => {
    const short = ["web.agents.chip.choose", "web.agents.picker.all", "web.agents.picker.builtin", "web.agents.picker.mine",
      "web.agents.tutor.entry", "web.agents.process.status.run", "web.agents.process.status.done", "web.agents.process.status.fail",
      "web.agents.process.status.skip", "web.agents.process.retry", "web.agents.editor.tryButton", "web.agents.editor.save"];
    for (const key of short) expect(String(at(en, key)).length, key).toBeLessThanOrEqual(12);
  });
});
