import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { MemoryPage as LazyMemoryPage } from "./lazy";
import en from "./locales/en.json";
import { setupMemory } from "./test-setup";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("MemoryPage", () => {
  it("opens on the profile tab and switches tabs", async () => {
    const user = userEvent.setup();
    setupMemory();
    expect(screen.getByRole("heading", { name: "记忆" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "档案" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "长期" }));
    expect(screen.getByRole("radio", { name: "长期" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("region", { name: "长期" })).toBeTruthy();
  });

  it("honours ?tab=", () => {
    setupMemory({}, "/me/agents/memory?tab=manage");
    expect(screen.getByRole("radio", { name: "管理" })).toHaveAttribute("aria-checked", "true");
  });

  it("falls back to the profile tab for an unknown ?tab=", () => {
    setupMemory({}, "/me/agents/memory?tab=nope");
    expect(screen.getByRole("radio", { name: "档案" })).toHaveAttribute("aria-checked", "true");
  });

  it("loads lazily through the public wrapper", async () => {
    setupMemory({}, "/me/agents/memory", <LazyMemoryPage />);
    expect(await screen.findByRole("radio", { name: "档案" })).toBeTruthy();
  });

  it("keeps English tab labels short enough for a 360 px screen", () => {
    for (const label of Object.values(en.web.agents.memory.tabs)) expect(label.length).toBeLessThanOrEqual(8);
  });
});
