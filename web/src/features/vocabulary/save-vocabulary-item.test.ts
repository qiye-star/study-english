import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { VOCABULARY_SERVER_ERRORS, deleteVocabularyItem, reviewVocabularyItem } from "./vocabulary-api";
import { translateServerError } from "~/api/error-messages";
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

  it("does not send a request for an empty word and shows a translated message", async () => {
    vi.mocked(toast.error).mockClear();
    const mock = createFetchMock({ "POST /api/vocabulary": () => json({ id: "v1" }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await saveVocabularyItem(api, i18n.t, { word: " \u0007 ", source: "manual" })).toBe(false);
    expect(mock.calls).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith("Nothing to add.");
  });

  it("translates real 409 responses (not due, already reviewed)", async () => {
    const mock = createFetchMock({
      "POST /api/vocabulary/a/review": () => json({ error: "Vocabulary item is not due" }, 409),
      "POST /api/vocabulary/b/review": () => json({ error: "Vocabulary item was already reviewed" }, 409),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const msg = async (id: string) => translateServerError(i18n.t, await reviewVocabularyItem(api, id, "good").catch((e) => e), VOCABULARY_SERVER_ERRORS);
    expect(await msg("a")).toBe("This word is not due yet.");
    expect(await msg("b")).toBe("This word was already reviewed.");
  });

  it("treats a deduplicated (existing) item as success", async () => {
    vi.mocked(toast.success).mockClear();
    const mock = createFetchMock({ "POST /api/vocabulary": () => json({ id: "existing", word: "a", box: 3 }) });
    expect(await saveVocabularyItem(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), i18n.t, { word: "a", source: "lookup" })).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Added to your vocabulary.");
  });

  it("translates a 404 on delete", async () => {
    const mock = createFetchMock({ "DELETE /api/vocabulary/x": () => json({ error: "Vocabulary item not found" }, 404) });
    const err = await deleteVocabularyItem(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), "x").catch((e) => e);
    expect(translateServerError(i18n.t, err, VOCABULARY_SERVER_ERRORS)).toBe("This word no longer exists.");
  });
});
