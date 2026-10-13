import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsProvider, useSettings } from "~/settings/settings-context";
import { ColorSchemeSync } from "./color-scheme-sync";

const html = document.documentElement;

function Probe() {
  const { colorScheme, setColorScheme } = useSettings();
  return <button onClick={() => setColorScheme("dark")}>{colorScheme}</button>;
}

afterEach(() => {
  html.classList.remove("dark");
  localStorage.clear();
});

describe("ColorSchemeSync (D12)", () => {
  it("applies the stored scheme on mount and follows changes made in 我的", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ colorScheme: "light" }));
    html.classList.add("dark");
    render(<SettingsProvider><ColorSchemeSync /><Probe /></SettingsProvider>);
    expect(html.classList.contains("dark")).toBe(false);
    await act(async () => screen.getByRole("button").click());
    expect(html.classList.contains("dark")).toBe(true);
  });

  it("is mounted inside SettingsProvider in app.tsx", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const app = readFileSync(path.resolve(here, "../app.tsx"), "utf8");
    expect(app).toMatch(/<SettingsProvider>\s*<ColorSchemeSync \/>/);
  });
});
