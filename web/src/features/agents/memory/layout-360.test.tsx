import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { setupMemory } from "./test-setup";

// jsdom 没有布局引擎:这里用「英文标签长度 + 无固定宽度类 + 横向滚动只在筛选条」的结构性检查守 360 px 不溢出;
// 真实宽度仍需在浏览器窗格 / 真机上看(Z1 记为未验证)。
const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BUTTON_CHARS = 28; // 全宽按钮(约 300 px、15 px 半粗)一行装得下
const MAX_TAB_CHARS = 8; // 四等分分段控件,每格约 80 px、13 px

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" })); void i18n.changeLanguage("en"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); });

describe("memory page at 360 px (English)", () => {
  it("keeps every button and tab label short enough for one line", async () => {
    const user = userEvent.setup();
    setupMemory({}, "/me/agents/memory");
    await screen.findByLabelText(/Native language/);
    for (const tab of screen.getAllByRole("radio")) expect((tab.textContent ?? "").length).toBeLessThanOrEqual(MAX_TAB_CHARS);
    for (const name of ["Items", "Recaps", "Manage"]) {
      await user.click(screen.getByRole("radio", { name }));
      await screen.findByRole("region", { name });
      if (name === "Manage") await screen.findByRole("button", { name: "Clear all memory" });
      if (name === "Items") await screen.findByTestId("memory-item-a");
      for (const button of screen.queryAllByRole("button")) {
        const label = button.textContent || button.getAttribute("aria-label") || "";
        expect(label.length, label).toBeLessThanOrEqual(MAX_BUTTON_CHARS);
      }
    }
  });

  it("has no fixed pixel widths wider than a 360 px screen in product code", () => {
    const sources = readdirSync(here).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    for (const file of sources) {
      const text = readFileSync(path.join(here, file), "utf8");
      for (const m of text.matchAll(/(?:^|[\s"'`])(?:min-)?w-\[(\d+)px\]/g)) expect(Number(m[1]), `${file}: ${m[0]}`).toBeLessThan(328);
    }
  });

  it("scrolls only the filter strip horizontally", () => {
    const text = readFileSync(path.join(here, "items-tab.tsx"), "utf8");
    expect(text.match(/overflow-x-auto/g)).toHaveLength(1);
    for (const file of ["profile-tab.tsx", "recaps-tab.tsx", "manage-tab.tsx", "memory-page.tsx"]) {
      expect(readFileSync(path.join(here, file), "utf8")).not.toContain("overflow-x-auto");
    }
  });
});
