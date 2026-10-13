import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const DICT_HIT = {
  hit: true, word: "country", phonetic: "ˈkʌntri", source: "dict", def_lang: "both",
  defs_zh: [{ pos: "n", text: "国家" }, { pos: "n", text: "乡下" }],
  defs_en: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
};
const AI = '{"word":"country","pos":"noun","definition":"a nation","translation":"国家","context_translation":"国家能为你做什么"}';
const CONFIG: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: [{ value: "alloy" }] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const ai = (mock: { calls: Array<{ url: URL; body?: unknown }> }) => mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions");
const dict = (mock: { calls: Array<{ url: URL; body?: unknown }> }) => mock.calls.filter((c) => c.url.pathname === "/api/dictionary/lookup");

function Page() {
  return (
    <>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </>
  );
}

async function selectText(needle: string) {
  const node = screen.getByTestId("ctx").firstChild!;
  const start = node.textContent!.indexOf(needle);
  await act(async () => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
const mount = (routes: Record<string, Handler>) => {
  const mock = createFetchMock({ ...CONFIG, ...routes });
  renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
};

describe("selection action bar", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("shows lookup, read aloud and add-to-vocabulary for a word", async () => {
    mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT) });
    await selectText("country");
    expect(await screen.findByTestId("lookup-trigger")).toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(await screen.findByTestId("lookup-read")).toBeInTheDocument();
    expect(screen.getByTestId("lookup-bar-vocab")).toBeInTheDocument();
  });

  it("offers translate and read aloud, but no add button, for a sentence and asks the dictionary nothing", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT) });
    await selectText("ask not what your country");
    expect(await screen.findByTestId("lookup-trigger")).toHaveTextContent("Translate");
    expect(await screen.findByTestId("lookup-read")).toBeInTheDocument();
    expect(screen.queryByTestId("lookup-bar-vocab")).toBeNull();
    expect(dict(mock)).toHaveLength(0);
  });

  it("adds the selected word with the dictionary meaning from the bar, without opening the drawer", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT), "POST /api/vocabulary": () => json({ id: "v1" }) });
    await selectText("country");
    await waitFor(() => expect(dict(mock)).toHaveLength(1));
    await userEvent.click(await screen.findByTestId("lookup-bar-vocab"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/vocabulary")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string)).toEqual({
      word: "country", meaning: "n. 国家；n. 乡下 · a nation with its own government", example: "ask not what your country can do for you", source: "lookup",
    });
    expect(screen.queryByTestId("lookup-drawer")).toBeNull();
  });
});

describe("dictionary-first lookup", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("shows a hit at once, labelled as dictionary, with no AI request until asked", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "dict");
    expect(screen.getByTestId("lookup-source")).toHaveTextContent("Dictionary");
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
    expect(screen.getByTestId("lookup-dict-en")).toHaveTextContent("a nation with its own government");
    expect(screen.getByTestId("lookup-dict-phrases")).toHaveTextContent("country club");
    expect(screen.getByTestId("lookup-result")).toHaveTextContent("/ˈkʌntri/");
    expect(ai(mock)).toHaveLength(0);
  });

  it("the AI explanation button calls the model once, with the sentence as context, and shows it below", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await userEvent.click(await screen.findByTestId("lookup-ai-explain"));
    await waitFor(() => expect(screen.getByTestId("lookup-ai-result")).toHaveTextContent("国家能为你做什么"));
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
    expect(ai(mock)).toHaveLength(1);
    expect(JSON.parse(JSON.parse(ai(mock)[0].body as string).messages[1].content)).toEqual({
      word: "country", context: "ask not what your country can do for you",
    });
    expect(screen.getByTestId("lookup-dict")).toBeInTheDocument(); // the dictionary part stays
  });

  it("a miss goes straight to the AI and is labelled as such", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json({ hit: false }),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("a nation"));
    expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "ai");
    expect(screen.getByTestId("lookup-source")).toHaveTextContent("AI lookup");
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
    expect(ai(mock)).toHaveLength(1);
  });

  it("a dictionary failure (429, 500, network) silently falls back to the AI path", async () => {
    for (const failing of [() => json({ error: "Too many requests, please try again later" }, 429), () => json({ error: "boom" }, 500)]) {
      resetKvCacheForTests();
      indexedDB.deleteDatabase("enjoy-web");
      const mock = mount({
        "POST /api/dictionary/lookup": failing,
        "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: AI } }] }),
      });
      await selectText("country");
      await userEvent.click(await screen.findByTestId("lookup-trigger"));
      await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
      expect(screen.getByTestId("lookup-source")).toHaveAttribute("data-source", "ai");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(ai(mock)).toHaveLength(1);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
      document.body.innerHTML = "";
    }
  });

  it("an AI error after a dictionary miss is translated, not the raw server text", async () => {
    mount({
      "POST /api/dictionary/lookup": () => json({ hit: false }),
      "POST /api/ai/chat/completions": () => json({ error: "Upstream unavailable" }, 502),
    });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "error"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upstream unavailable");
  });

  it("English only with no English definition shows the Chinese ones (spec D2)", async () => {
    mount({ "POST /api/dictionary/lookup": () => json({ ...DICT_HIT, def_lang: "en", defs_en: [] }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家"));
    expect(screen.queryByTestId("lookup-dict-en")).toBeNull();
  });

  it("the drawer's add button uses the dictionary meaning", async () => {
    const mock = mount({ "POST /api/dictionary/lookup": () => json(DICT_HIT), "POST /api/vocabulary": () => json({ id: "v1" }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await userEvent.click(await screen.findByTestId("lookup-vocab"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/vocabulary")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string).word).toBe("country");
  });

  it("a long selection never asks the dictionary and the translate path is unchanged", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: "不要问" } }] }),
    });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("不要问"));
    expect(dict(mock)).toHaveLength(0);
    expect(screen.queryByTestId("lookup-source")).toBeNull();
    expect(screen.queryByTestId("lookup-ai-explain")).toBeNull();
  });

  it("switching to the dictionary on a sentence does not ask the server either", async () => {
    const mock = mount({
      "POST /api/dictionary/lookup": () => json(DICT_HIT),
      "POST /api/ai/chat/completions": (call) => (JSON.parse(call.body as string).response_format
        ? json({ choices: [{ message: { content: '{"word":"x","definition":"a quote"}' } }] })
        : json({ choices: [{ message: { content: "译文" } }] })),
    });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("译文"));
    await userEvent.click(screen.getByTestId("lookup-switch-mode"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("a quote"));
    expect(dict(mock)).toHaveLength(0);
  });

  it("closing the drawer mid-request ignores a late dictionary answer", async () => {
    let release: () => void = () => {};
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = mount({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(DICT_HIT)); }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "loading");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(ai(mock)).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
