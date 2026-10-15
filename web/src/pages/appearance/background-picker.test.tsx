import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { renderWithProviders } from "~/test/render";
import { BackgroundPicker } from "./background-picker";

describe("BackgroundPicker (plan 2026-10-15-liquid-glass R-L3-4)", () => {
  beforeEach(async () => { window.localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); await i18n.changeLanguage("zh-CN"); window.localStorage.removeItem(GLASS_THEME_KEY); resetGlassThemeMemory(); });
  afterEach(async () => { window.localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); resetGlassThemeMemory(); });

  it("edits the light slot by default and the dark slot after switching", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.click(screen.getByRole("button", { name: "纸白" }));
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    fireEvent.click(screen.getByRole("radio", { name: "深色模式" }));
    fireEvent.click(screen.getByRole("button", { name: "纯黑" }));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
    expect(getGlassTheme().bg.light.swatch).toBe(3);
  });

  it("shows the AA clamp hint for a custom colour that is too dark for a light page", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.change(screen.getByRole("slider", { name: "亮度" }), { target: { value: "55" } });
    expect(getGlassTheme().bg.light.swatch).toBeNull();
    expect(screen.getByTestId("bg-clamp-hint")).toHaveTextContent("亮度 55 →");
  });

  it("sets the style and an optional second colour", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.click(screen.getByRole("radio", { name: "颗粒" }));
    expect(getGlassTheme().bgStyle).toBe("grain");
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 雾蓝" }));
    expect(getGlassTheme().bg.light.second).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 无" }));
    expect(getGlassTheme().bg.light.second).toBeNull();
  });
});
