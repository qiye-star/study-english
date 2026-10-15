import "fake-indexeddb/auto";
import { screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { LookupLayer } from "~/features/lookup";
import i18n from "~/i18n";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { TestPointerEvent, installHighlightStub, stubCaret, tapAt, unstubCaret } from "~/test/tap-lookup";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const TALK = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }), defsEn: DEFS_EN } as unknown as Card;

let highlights: ReturnType<typeof installHighlightStub>;
beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  highlights = installHighlightStub();
  indexedDB.deleteDatabase("enjoy-web");
  resetKvCacheForTests();
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => { unstubCaret(); window.getSelection()?.removeAllRanges(); void i18n.changeLanguage("en"); });

describe("tap-to-lookup on a wordbook card definition", () => {
  it("tap once underlines a definition word, tap again shows the lookup bar", async () => {
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) });
    renderWithProviders(<><WordCardView card={TALK} defLang="both" phrasesOpen /><LookupLayer /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const def = within(screen.getByTestId("word-defs-en")).getAllByRole("listitem")[0];
    const textNode = Array.from(def.childNodes).flatMap(function walk(n): Node[] { return n.nodeType === Node.TEXT_NODE ? [n] : Array.from(n.childNodes).flatMap(walk); }).find((n) => /[a-z]{4,}/i.test(n.textContent ?? ""))!;
    const word = /[A-Za-z]{4,}/.exec(textNode.textContent!)!;
    stubCaret(textNode, word.index + 2);
    tapAt(def);
    expect(highlights.rangesOf("lookup-pending").map((r) => r.toString())).toEqual([word[0]]);
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
    tapAt(def);
    expect(window.getSelection()!.toString()).toBe(word[0]);
    expect(await screen.findByTestId("lookup-bar")).toBeInTheDocument();
  });
});
