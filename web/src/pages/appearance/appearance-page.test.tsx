import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColorSchemeSync } from "~/layout/color-scheme-sync";
import i18n from "~/i18n";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { blurLayers, setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { AppearancePage } from "./appearance-page";

describe("AppearancePage (plan 2026-10-15-liquid-glass L3)", () => {
  beforeEach(async () => {
    window.localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    setLiquid(true);
  });
  afterEach(async () => {
    setLiquid(false);
    window.localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
    resetGlassThemeMemory();
  });

  it("redirects to Me when the liquid skin is off", () => {
    setLiquid(false);
    renderWithProviders(<AppearancePage />, { route: "/me/appearance", path: "/me/appearance" });
    expect(screen.getByTestId("location")).toHaveTextContent("/me");
  });

  it("renders every section with one own blur layer (the preview strip)", () => {
    const { container } = renderWithProviders(<AppearancePage />);
    for (const name of ["颜色模式", "预设", "玻璃", "形状与光影", "背景", "玻璃效果"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(blurLayers(container).length).toBeLessThanOrEqual(2);
  });

  it("a fresh user sees 清透 selected, named, and no readability-floor warning", () => {
    renderWithProviders(<AppearancePage />);
    expect(screen.getByRole("button", { name: /清透/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /磨砂/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("appearance-preset-name")).toHaveTextContent("清透");
    expect(screen.queryByText("已到可读下限")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /磨砂/ }));
    expect(getGlassTheme().preset).toBe("frosted");
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByRole("button", { name: /清透/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("presets: 实色 sets solid values and the solid background; a slider move makes it custom", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.click(screen.getByRole("button", { name: /实色/ }));
    expect(getGlassTheme()).toMatchObject({ preset: "solid", blur: 0, bgStyle: "solid" });
    fireEvent.change(screen.getByRole("slider", { name: "模糊" }), { target: { value: "1" } });
    expect(getGlassTheme().preset).toBe("custom");
    expect(screen.getByTestId("appearance-preset-name")).toHaveTextContent("自定义");
  });

  it("shows the readability floor at full transparency", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.change(screen.getByRole("slider", { name: "透明度" }), { target: { value: "100" } });
    expect(getGlassTheme().tint).toBeCloseTo(0.3);
    expect(screen.getByText("已到可读下限")).toBeInTheDocument();
  });

  it("radius presets and slider, 减弱, reset", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(getGlassTheme().radius).toBe(0.6);
    expect(screen.getByRole("button", { name: "紧凑" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("slider", { name: "圆角" }), { target: { value: "0.8" } });
    expect(screen.getByRole("button", { name: "紧凑" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(screen.getByRole("slider", { name: "圆角" })).toHaveAttribute("aria-valuetext", "16 px");
    fireEvent.click(screen.getByRole("radio", { name: "减弱" }));
    expect(getGlassTheme().reduced).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(getGlassTheme()).toEqual(GLASS_DEFAULTS);
  });
});

describe("AppearancePage colour mode and background (one card, no own mode tabs)", () => {
  beforeEach(async () => {
    window.localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN", colorScheme: "light" }));
    await i18n.changeLanguage("zh-CN");
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    document.documentElement.classList.remove("dark");
    setLiquid(true);
  });
  afterEach(async () => {
    document.documentElement.classList.remove("dark");
    setLiquid(false);
    window.localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
    resetGlassThemeMemory();
  });

  it("puts the 颜色模式 control and the background picker in the same card, colour mode first", () => {
    renderWithProviders(<AppearancePage />);
    const card = screen.getByTestId("appearance-background-card");
    const modeGroup = within(card).getByRole("radiogroup", { name: "颜色模式" });
    const picker = within(card).getByTestId("appearance-background");
    expect(modeGroup.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByRole("radio", { name: "深色" })).toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup", { name: "颜色模式" })).toHaveLength(1);
  });

  it("has no 浅色模式 / 深色模式 tabs in the background card", () => {
    renderWithProviders(<AppearancePage />);
    const card = screen.getByTestId("appearance-background-card");
    expect(within(card).queryByRole("radio", { name: "浅色模式" })).toBeNull();
    expect(within(card).queryByRole("radio", { name: "深色模式" })).toBeNull();
  });

  it("switching the colour mode flips the background palette and keeps the other mode's stored background", async () => {
    renderWithProviders(<><ColorSchemeSync /><AppearancePage /></>);
    const card = screen.getByTestId("appearance-background-card");
    fireEvent.click(within(card).getByRole("button", { name: "纸白" }));
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    expect(screen.getByTestId("appearance-bg-hint")).toHaveTextContent("当前是浅色模式");

    fireEvent.click(within(card).getByRole("radio", { name: "深色" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await waitFor(() => expect(within(card).queryByRole("button", { name: "纸白" })).toBeNull());
    expect(within(card).getByRole("button", { name: "纯黑" })).toBeInTheDocument();
    expect(screen.getByTestId("appearance-bg-hint")).toHaveTextContent("当前是深色模式");
    expect(getGlassTheme().bg.light.swatch).toBe(3);

    fireEvent.click(within(card).getByRole("button", { name: "纯黑" }));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
    expect(getGlassTheme().bg.light.swatch).toBe(3);

    fireEvent.click(within(card).getByRole("radio", { name: "浅色" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "纸白" })).toHaveAttribute("aria-pressed", "true"));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
  });
});

describe("AppearancePage layout classes", () => {
  it("adds only a small gap under the last row (AppShell main already reserves the tab-bar space)", () => {
    setLiquid(true);
    const { container } = renderWithProviders(<AppearancePage />);
    expect(container.innerHTML).toContain("pb-8");
    expect(container.innerHTML).not.toContain("tab-bar-space");
    setLiquid(false);
  });
});
