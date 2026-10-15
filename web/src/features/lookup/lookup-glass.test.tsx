import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const DICT = {
  hit: true, word: "country", phonetic: "ˈkʌntri", source: "dict", def_lang: "en",
  defs_zh: [{ pos: "n", text: "国家" }], defs_en: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
};

async function openDrawer() {
  const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json(DICT) });
  renderWithProviders(
    <WithShadowSheet><p data-testid="ctx" data-lookup-context>ask not what your country can do</p><LookupLayer /></WithShadowSheet>,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
  );
  const node = screen.getByTestId("ctx").firstChild!;
  const start = node.textContent!.indexOf("country");
  await act(async () => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, start + 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await userEvent.click(await screen.findByTestId("lookup-trigger"));
  await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
}
const cls = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe("glass lookup drawer (plan 2026-10-15 R-G3, R-G4)", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("is a floating glass card over a light scrim, with well-style controls", async () => {
    await openDrawer();
    expect(cls("lookup-drawer")).toEqual(expect.arrayContaining(["glass-sheet", "rounded-dock"]));
    expect(cls("lookup-drawer")).not.toContain("rounded-t-xl");
    expect(cls("sheet-overlay")).toContain("bg-[color:var(--lookup-scrim)]");
    expect(cls("lookup-source")).toEqual(expect.arrayContaining(["rounded-full", "bg-[color:var(--glass-well)]"]));
    expect(cls("lookup-switch-mode")).toEqual(expect.arrayContaining(["rounded-full", "bg-[color:var(--glass-well)]"]));
    expect(cls("lookup-ai-explain")).toContain("bg-[color:var(--glass-well)]");
  });

  it("keeps the 中文 chip: a well when off, blue tint when on (behaviour unchanged)", async () => {
    await openDrawer();
    expect(cls("lookup-zh")).toContain("bg-[color:var(--glass-well)]");
    await userEvent.click(screen.getByTestId("lookup-zh"));
    expect(cls("lookup-zh")).toContain("bg-blue-tint");
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
  });
});
