import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { DEFS_EN } from "./test-fixtures";
import {
  DEFAULT_DEF_LANG, DEF_LANGS, DEF_LANG_PATH, DEF_POS_CODES, defLangOf, defView, enPosLabel, groupDefs, isDefLang, saveDefLang,
} from "./def-lang";
import { fetchLearnedCard, type WordbookConfig } from "./wordbook-api";
import { posLabel } from "./word-card";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const ON = { enabled: true, aiAvailable: false, defaults: { dailyNew: 20, reviewCap: 100 }, books: [], learn: { autoplay: true, showExample: true } } as WordbookConfig;

describe("definitions preference", () => {
  it("accepts exactly the three server values", () => {
    expect([...DEF_LANGS]).toEqual(["both", "zh", "en"]);
    for (const ok of ["both", "zh", "en"]) expect(isDefLang(ok)).toBe(true);
    for (const bad of ["", "EN", "english", null, undefined, 1, {}]) expect(isDefLang(bad)).toBe(false);
  });

  it("reads defLang with a safe default (old servers have no key): English only", () => {
    expect(DEFAULT_DEF_LANG).toBe("en");
    expect(defLangOf(null)).toBe("en");
    expect(defLangOf({ enabled: false })).toBe("en");
    expect(defLangOf(ON)).toBe("en");
    expect(defLangOf({ ...ON, defLang: "both" } as WordbookConfig)).toBe("both");
    expect(defLangOf({ ...ON, defLang: "zh" } as WordbookConfig)).toBe("zh");
    expect(defLangOf({ ...ON, defLang: "klingon" } as unknown as WordbookConfig)).toBe("en");
  });

  it("PATCHes def_lang to the enrollment endpoint (AD-1) and reads def_lang from the response", async () => {
    const { mock, api } = client({ "PATCH /api/wordbook/enrollment": () => json({ def_lang: "en" }) });
    expect(await saveDefLang(api, "en")).toEqual({ defLang: "en" });
    const call = mock.calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe(DEF_LANG_PATH);
    expect(DEF_LANG_PATH).toBe("/api/wordbook/enrollment");
    expect(call.url.search).toBe("");
    expect(JSON.parse(String(call.body))).toEqual({ def_lang: "en" });
  });

  it("also works with an enrollment-shaped response (book in progress) and falls back to the sent value", async () => {
    const { api } = client({ "PATCH /api/wordbook/enrollment": () => json({ book_id: "cet4", status: "active", def_lang: "zh" }) });
    expect(await saveDefLang(api, "zh")).toEqual({ defLang: "zh" });
    const bare = client({ "PATCH /api/wordbook/enrollment": () => json({}) });
    expect(await saveDefLang(bare.api, "both")).toEqual({ defLang: "both" });
  });

  it("camelCases defs_en on cards and leaves cards without it alone", async () => {
    const { api } = client({
      "POST /api/wordbook/learned/card": () => json({
        key: "talk", word: "talk", us: "", uk: "", senses: [], phrases: [], examples: [], defs_en: [{ pos: "v", text: "exchange thoughts" }],
      }),
    });
    expect((await fetchLearnedCard(api, "cet4", "talk")).defsEn).toEqual([{ pos: "v", text: "exchange thoughts" }]);
    const old = client({ "POST /api/wordbook/learned/card": () => json({ key: "talk", word: "talk", us: "", uk: "", senses: [], phrases: [], examples: [] }) });
    expect("defsEn" in (await fetchLearnedCard(old.api, "cet4", "talk"))).toBe(false);
  });
});

describe("POS labels", () => {
  it("match the labels the Chinese rows already use (posLabel on the wordbook type)", () => {
    for (const code of ["n", "v", "prep", "pron", "conj", "art", "num", "aux", "int"]) expect(enPosLabel(code)).toBe(posLabel(code));
    expect(enPosLabel("a")).toBe(posLabel("adj"));
    expect(enPosLabel("r")).toBe(posLabel("adv"));
    expect(DEF_POS_CODES).toEqual(["n", "v", "a", "r", "prep", "pron", "conj", "art", "num", "aux", "int"]);
  });
  it("falls back to a dotted code and never reads the prototype", () => {
    expect(enPosLabel("x")).toBe("x.");
    expect(enPosLabel("x.")).toBe("x.");
    expect(enPosLabel("constructor")).toBe("constructor.");
    expect(enPosLabel("")).toBe("");
  });
});

describe("groupDefs", () => {
  it("groups by POS in server order and keeps at most two texts per POS", () => {
    expect(groupDefs(DEFS_EN)).toEqual([
      { pos: "v", label: "v.", texts: ["exchange thoughts or ideas by speaking", "use language to express something"] },
      { pos: "n", label: "n.", texts: ["an exchange of ideas by speaking"] },
    ]);
  });
  it("drops blank texts and tolerates a missing or malformed list", () => {
    expect(groupDefs(undefined)).toEqual([]);
    expect(groupDefs([])).toEqual([]);
    expect(groupDefs("nope" as unknown as undefined)).toEqual([]);
    expect(groupDefs([{ pos: "n", text: "   " }, { pos: "v", text: " go " }])).toEqual([{ pos: "v", label: "v.", texts: ["go"] }]);
  });
});

describe("defView (which definition rows a card shows)", () => {
  const ZH = [{ pos: "v", text: "说话" }];
  const EN = [{ pos: "v", text: "speak to someone" }];
  const view = (...a: Parameters<typeof defView>) => {
    const { groups, ...flags } = defView(...a);
    return { groups: groups.length, ...flags };
  };

  it("both: Chinese rows plus English rows, nothing to peek at", () => {
    expect(view("both", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: true, canPeek: false });
  });
  it("zh: Chinese rows only", () => {
    expect(view("zh", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: false, showSenses: true, canPeek: false });
  });
  it("en: English rows only, and the Chinese rows can be peeked", () => {
    expect(view("en", { senses: ZH, defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: false, canPeek: true });
    expect(view("en", { senses: ZH, defsEn: EN }, true)).toEqual({ groups: 1, showDefs: true, showSenses: true, canPeek: true });
  });
  it("en without English definitions falls back to Chinese and offers no peek (nothing to switch)", () => {
    for (const defsEn of [undefined, [], [{ pos: "n", text: "   " }]]) {
      expect(view("en", { senses: ZH, defsEn })).toEqual({ groups: 0, showDefs: false, showSenses: true, canPeek: false });
      expect(view("en", { senses: ZH, defsEn }, true).showSenses).toBe(true);
    }
  });
  it("en without Chinese senses has nothing to peek at either", () => {
    expect(view("en", { senses: [], defsEn: EN })).toEqual({ groups: 1, showDefs: true, showSenses: false, canPeek: false });
  });
  it("a card with neither renders no definition rows in any mode", () => {
    for (const mode of ["both", "zh", "en"] as const) {
      expect(view(mode, { senses: [], defsEn: undefined })).toEqual({ groups: 0, showDefs: false, showSenses: false, canPeek: false });
    }
  });
});
