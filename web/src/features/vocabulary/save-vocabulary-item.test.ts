import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { VOCABULARY_SERVER_ERRORS } from "./vocabulary-api";
import { saveVocabularyItem, vocabularyFromLookup } from "./save-vocabulary-item";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));
const lookup = { word: "country", lemma: "country", pronunciation: "ˈkʌntri", pos: "noun", definition: "a nation", translation: "国家", contextTranslation: "" };

describe("save to vocabulary", () => {
  it("maps a lookup result (R19)", () => {
    expect(vocabularyFromLookup(lookup, { text: "Country", context: "ask not what your  country can do" }))
      .toEqual({ word: "country", meaning: "noun · 国家 · a nation", example: "ask not what your country can do", source: "lookup" });
    expect(vocabularyFromLookup({ ...lookup, word: "", pos: "", definition: "" }, { text: " Hello ", context: "hello" }))
      .toEqual({ word: "Hello", meaning: "国家", example: undefined, source: "lookup" });
  });

  it("toasts success and translated failures", async () => {
    const ok = createFetchMock({ "POST /api/vocabulary": () => json({ id: "v1" }) });
    expect(await saveVocabularyItem(new ApiClient({ getToken: () => "t", fetchImpl: ok.fetch }), i18n.t, { word: "a", source: "manual" })).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Added to your vocabulary.");
    const full = createFetchMock({ "POST /api/vocabulary": () => json({ error: "Vocabulary limit reached" }, 429) });
    expect(await saveVocabularyItem(new ApiClient({ getToken: () => "t", fetchImpl: full.fetch }), i18n.t, { word: "a", source: "manual" })).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Your vocabulary is full. Delete some words first.");
  });

  it("has a translated message for every server error, including the already-reviewed 409", () => {
    expect(Object.keys(VOCABULARY_SERVER_ERRORS)).toEqual(expect.arrayContaining(["Vocabulary item was already reviewed"]));
    for (const key of Object.values(VOCABULARY_SERVER_ERRORS)) expect(i18n.exists(key)).toBe(true);
  });
});
