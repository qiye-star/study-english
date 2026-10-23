import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { renderWithProviders } from "~/test/render";
import { BackgroundPicker } from "./background-picker";

const LIGHT_NAMES = ["雾灰", "暖灰", "冷灰", "纸白", "鼠尾草", "雾蓝", "藕粉", "燕麦"];
const DARK_NAMES = ["石墨", "暖炭", "冷夜", "墨绿", "深海", "酒灰", "纯黑", "茶褐"];

/** 色板按钮的名字(只取 4 列色板网格里的 8 个,不含「第二颜色」行) */
function swatchNames(): string[] {
  const grid = screen.getByTestId("appearance-background-swatches");
  return within(grid).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
}

describe("BackgroundPicker (plan 2026-10-15-liquid-glass R-L3-4)", () => {
  beforeEach(async () => {
    window.localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    document.documentElement.classList.remove("dark");
  });
  afterEach(async () => {
    document.documentElement.classList.remove("dark");
    window.localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
    resetGlassThemeMemory();
  });

  it("has no own 浅色/深色 tabs: the colour mode control is the only mode switch", () => {
    renderWithProviders(<BackgroundPicker />);
    expect(screen.queryByRole("radiogroup", { name: "正在编辑" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "浅色模式" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "深色模式" })).toBeNull();
  });

  it("in light mode shows only light swatches, and a selection writes theme.bg.light only", () => {
    renderWithProviders(<BackgroundPicker />);
    expect(swatchNames()).toEqual(LIGHT_NAMES);
    for (const name of DARK_NAMES) expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "纸白" }));
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    expect(getGlassTheme().bg.dark).toEqual(GLASS_DEFAULTS.bg.dark);
  });

  it("in dark mode shows only dark swatches, and a selection writes theme.bg.dark only", () => {
    document.documentElement.classList.add("dark");
    renderWithProviders(<BackgroundPicker />);
    expect(swatchNames()).toEqual(DARK_NAMES);
    for (const name of LIGHT_NAMES) expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "纯黑" }));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
    expect(getGlassTheme().bg.light).toEqual(GLASS_DEFAULTS.bg.light);
  });

  it("the hint under the title reflects the current mode", () => {
    const first = renderWithProviders(<BackgroundPicker />);
    expect(screen.getByTestId("appearance-bg-hint")).toHaveTextContent("当前是浅色模式,这里只显示浅色背景;切换到深色模式后可选深色背景");
    first.unmount();
    document.documentElement.classList.add("dark");
    renderWithProviders(<BackgroundPicker />);
    expect(screen.getByTestId("appearance-bg-hint")).toHaveTextContent("当前是深色模式,这里只显示深色背景;切换到浅色模式后可选浅色背景");
  });

  it("switching the mode flips the palette and keeps the other mode's stored background", async () => {
    renderWithProviders(<BackgroundPicker />);
    fireEvent.click(screen.getByRole("button", { name: "纸白" }));
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    document.documentElement.classList.add("dark");
    await waitFor(() => expect(screen.queryByRole("button", { name: "纸白" })).toBeNull());
    expect(screen.getByRole("button", { name: "纯黑" })).toBeInTheDocument();
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "纯黑" }));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
    document.documentElement.classList.remove("dark");
    await waitFor(() => expect(screen.getByRole("button", { name: "纸白" })).toHaveAttribute("aria-pressed", "true"));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
  });

  it("shows the AA clamp hint for a custom colour that is too dark for a light page", () => {
    renderWithProviders(<BackgroundPicker />);
    fireEvent.change(screen.getByRole("slider", { name: "亮度" }), { target: { value: "55" } });
    expect(getGlassTheme().bg.light.swatch).toBeNull();
    expect(screen.getByTestId("bg-clamp-hint")).toHaveTextContent("亮度 55 →");
  });

  it("sets the style and an optional second colour", () => {
    renderWithProviders(<BackgroundPicker />);
    fireEvent.click(screen.getByRole("radio", { name: "颗粒" }));
    expect(getGlassTheme().bgStyle).toBe("grain");
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 雾蓝" }));
    expect(getGlassTheme().bg.light.second).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 无" }));
    expect(getGlassTheme().bg.light.second).toBeNull();
  });
});
