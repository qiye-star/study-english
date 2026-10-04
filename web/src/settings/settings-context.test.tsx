import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { SettingsProvider, detectLanguage, nativeLanguageCode, useSettings } from "./settings-context";

function Probe() {
  const { language, setLanguage } = useSettings();
  return <button onClick={() => setLanguage("zh-CN")}>{language}</button>;
}

describe("settings", () => {
  beforeEach(() => localStorage.clear());
  it.each([["zh-TW", "zh-CN"], ["zh-CN", "zh-CN"], ["es-MX", "es"], ["en-GB", "en"], ["fr", "en"], [undefined, "en"]] as const)(
    "detectLanguage(%s) = %s", (input, expected) => expect(detectLanguage(input)).toBe(expected),
  );
  it("maps UI language to the native language used for translation", () => {
    expect(nativeLanguageCode("zh-CN")).toBe("zh-CN");
    expect(nativeLanguageCode("es")).toBe("es-ES");
    expect(nativeLanguageCode("en")).toBe("en-US");
  });
  it("persists the choice and switches i18n", async () => {
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await act(async () => screen.getByRole("button").click());
    expect(screen.getByRole("button")).toHaveTextContent("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN" });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("applies the saved language synchronously on the first render (no flash of the default)", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    const seen: string[] = [];
    function Spy(): null { seen.push(i18n.language); return null; }
    render(<SettingsProvider><Spy /></SettingsProvider>);
    expect(seen[0]).toBe("zh-CN");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
