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
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN", roomVoiceAutoText: false, colorScheme: "system" });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  describe("roomVoiceAutoText", () => {
    function AutoProbe() {
      const { roomVoiceAutoText, setRoomVoiceAutoText, setLanguage } = useSettings();
      return (
        <>
          <span data-testid="auto">{String(roomVoiceAutoText)}</span>
          <button onClick={() => setRoomVoiceAutoText(true)}>on</button>
          <button onClick={() => setLanguage("en")}>en</button>
        </>
      );
    }
    const stored = () => JSON.parse(localStorage.getItem("enjoy-web.settings")!);

    it("defaults to off for old storage and keeps the language when turned on", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
      render(<SettingsProvider><AutoProbe /></SettingsProvider>);
      expect(screen.getByTestId("auto")).toHaveTextContent("false");
      await act(async () => screen.getByRole("button", { name: "on" }).click());
      expect(screen.getByTestId("auto")).toHaveTextContent("true");
      expect(stored()).toEqual({ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "system" });
      await act(async () => screen.getByRole("button", { name: "en" }).click());
      expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true, colorScheme: "system" });
    });

    it("ignores a non-boolean value but keeps a valid language", () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", roomVoiceAutoText: "yes" }));
      render(<SettingsProvider><AutoProbe /></SettingsProvider>);
      expect(screen.getByTestId("auto")).toHaveTextContent("false");
    });

    it("keeps the preference when the stored language is invalid", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "fr", roomVoiceAutoText: true }));
      render(<SettingsProvider><AutoProbe /></SettingsProvider>);
      expect(screen.getByTestId("auto")).toHaveTextContent("true");
      await act(async () => { await i18n.changeLanguage("en"); });
    });
  });

  describe("colorScheme (D12)", () => {
    function SchemeProbe() {
      const { colorScheme, setColorScheme, setLanguage, setRoomVoiceAutoText } = useSettings();
      return (
        <>
          <span data-testid="scheme">{colorScheme}</span>
          <button onClick={() => setColorScheme("dark")}>dark</button>
          <button onClick={() => setLanguage("en")}>en</button>
          <button onClick={() => setRoomVoiceAutoText(true)}>auto</button>
        </>
      );
    }
    const stored = () => JSON.parse(localStorage.getItem("enjoy-web.settings")!);

    it("defaults to system for old storage and keeps the other preferences when it changes", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN", roomVoiceAutoText: true }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      expect(screen.getByTestId("scheme")).toHaveTextContent("system");
      await act(async () => screen.getByRole("button", { name: "dark" }).click());
      expect(screen.getByTestId("scheme")).toHaveTextContent("dark");
      expect(stored()).toEqual({ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "dark" });
      await act(async () => screen.getByRole("button", { name: "en" }).click());
      expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true, colorScheme: "dark" });
      await act(async () => { await i18n.changeLanguage("en"); });
    });

    it("falls back to system for a corrupt value without touching the other fields", () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", roomVoiceAutoText: true, colorScheme: 3 }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      expect(screen.getByTestId("scheme")).toHaveTextContent("system");
    });

    it("keeps the colour scheme when the room voice switch is turned on", async () => {
      localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en", colorScheme: "light" }));
      render(<SettingsProvider><SchemeProbe /></SettingsProvider>);
      await act(async () => screen.getByRole("button", { name: "auto" }).click());
      expect(stored()).toEqual({ language: "en", roomVoiceAutoText: true, colorScheme: "light" });
    });
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
