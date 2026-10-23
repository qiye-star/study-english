import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ZH_DEFS_PREF_KEY } from "~/lib/storage";
import { resetZhDefsModeMemory, setZhDefsMode } from "~/settings/zh-defs-pref";
import { drawerDefs, type DictEntry } from "./dictionary";
import { DictionaryResult } from "./dictionary-result";

const entry = (over: Partial<DictEntry> = {}): DictEntry => ({
  word: "country", phonetic: "ˈkʌntri",
  defsZh: [{ pos: "n", text: "国家" }],
  defsEn: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
  defLang: "en", ...over,
});

beforeEach(() => { void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("drawerDefs (plan 2026-10-14-review-bilingual-longpress R-Z4)", () => {
  it("hides Chinese definitions and phrase translations under English-only until peek", () => {
    expect(drawerDefs(entry(), false)).toEqual({ zh: [], en: entry().defsEn, phraseZh: false, canPeek: true });
    expect(drawerDefs(entry(), true)).toEqual({ zh: entry().defsZh, en: entry().defsEn, phraseZh: true, canPeek: true });
  });

  it("needs no chip when Chinese is already shown or the word has no English definition", () => {
    expect(drawerDefs(entry({ defLang: "both" }))).toMatchObject({ zh: entry().defsZh, phraseZh: true, canPeek: false });
    expect(drawerDefs(entry({ defLang: "zh" }))).toMatchObject({ zh: entry().defsZh, en: [], phraseZh: true, canPeek: false });
    expect(drawerDefs(entry({ defsEn: [] }))).toMatchObject({ zh: entry().defsZh, phraseZh: true, canPeek: false });
  });

  it("offers the chip for phrase translations alone, and none when there is no Chinese", () => {
    expect(drawerDefs(entry({ defsZh: [] })).canPeek).toBe(true);
    expect(drawerDefs(entry({ defsZh: [], phrases: [{ en: "country club", zh: "" }] })).canPeek).toBe(false);
  });
});

describe("DictionaryResult · 中文 chip", () => {
  it("under English-only shows English only, and the chip brings Chinese definitions and phrase translations back", async () => {
    render(<DictionaryResult entry={entry()} />);
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
    expect(screen.getByTestId("lookup-dict-en")).toHaveTextContent("a nation with its own government");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("country club");
    expect(screen.getByTestId("lookup-dict-phrases")).not.toHaveTextContent("乡村俱乐部");
    const chip = screen.getByTestId("lookup-zh");
    expect(chip).toHaveTextContent("中文");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).toMatch(/\bmin-h-tap\b/);
    await userEvent.click(chip);
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("乡村俱乐部");
    expect(screen.getByTestId("lookup-dict-en")).toBeTruthy();
    expect(screen.getByTestId("lookup-zh")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("lookup-zh"));
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
  });

  it("has no chip when Chinese is already shown or there is none", () => {
    for (const over of [{ defLang: "both" as const }, { defLang: "zh" as const }, { defsEn: [] as DictEntry["defsEn"] }, { defsZh: [] as DictEntry["defsZh"], phrases: [] as DictEntry["phrases"] }]) {
      const { unmount } = render(<DictionaryResult entry={entry(over)} />);
      expect(screen.queryByTestId("lookup-zh")).toBeNull();
      unmount();
    }
  });

  it("resets for the next lookup (a new entry object)", async () => {
    const { rerender } = render(<DictionaryResult entry={entry()} />);
    await userEvent.click(screen.getByTestId("lookup-zh"));
    rerender(<DictionaryResult entry={entry({ word: "nation" })} />);
    expect(screen.getByTestId("lookup-zh")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("lookup-dict-zh")).toBeNull();
  });
});

describe("DictionaryResult · 中文释义点击显示", () => {
  beforeEach(() => setZhDefsMode("tap"));
  afterEach(() => {
    localStorage.removeItem(ZH_DEFS_PREF_KEY);
    resetZhDefsModeMemory();
  });

  it("covers the Chinese definitions in place with a glass-well button, reveals on tap and hides again for a new lookup", async () => {
    const { rerender } = render(<DictionaryResult entry={entry({ defLang: "both" })} />);
    expect(screen.getByTestId("zh-defs-cover")).toContainElement(screen.getByTestId("lookup-dict-zh"));
    expect(screen.getByTestId("lookup-dict-zh")).not.toBeVisible();
    const btn = screen.getByRole("button", { name: "显示中文释义" });
    expect(btn.className).toContain("--glass-well");
    await userEvent.click(btn);
    expect(screen.getByTestId("lookup-dict-zh")).toBeVisible();
    rerender(<DictionaryResult entry={entry({ defLang: "both", word: "nation" })} />);
    expect(screen.getByTestId("lookup-dict-zh")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "显示中文释义" })).toBeInTheDocument();
  });

  it("English-only with English definitions is unchanged: no cover, the 中文 chip brings Chinese back", async () => {
    render(<DictionaryResult entry={entry()} />);
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
    expect(screen.getByTestId("lookup-zh")).toBeTruthy();
    await userEvent.click(screen.getByTestId("lookup-zh"));
    expect(screen.getByTestId("lookup-dict-zh")).toBeVisible();
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
  });

  it("English-only with no English definitions falls back to Chinese, which is covered", () => {
    render(<DictionaryResult entry={entry({ defsEn: [] })} />);
    expect(screen.getByTestId("zh-defs-cover")).toBeInTheDocument();
  });
});
