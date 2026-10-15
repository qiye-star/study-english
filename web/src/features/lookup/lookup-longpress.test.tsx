import "fake-indexeddb/auto";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

type CaretDoc = Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
function touch(el: Element, type: string, kind = "touch") {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 12 });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: kind }, isPrimary: { value: true } });
  el.dispatchEvent(e);
}
function Page() {
  return (
    <WithShadowSheet>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </WithShadowSheet>
  );
}
const mount = () => {
  const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) });
  renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const text = screen.getByTestId("ctx").firstChild!;
  (document as CaretDoc).caretRangeFromPoint = () => {
    const r = document.createRange();
    r.setStart(text, text.textContent!.indexOf("country") + 2);
    r.collapse(true);
    return r;
  };
};

describe("global long-press lookup (plan 2026-10-15 R-L1–R-L3)", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });
  afterEach(() => { delete (document as CaretDoc).caretRangeFromPoint; window.getSelection()?.removeAllRanges(); });

  it("long-pressing a word in a lookup context selects it and shows the bar for a word", async () => {
    mount();
    touch(screen.getByTestId("ctx"), "pointerdown");
    expect(await screen.findByTestId("lookup-bar", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(window.getSelection()!.toString()).toBe("country");
    expect(screen.getByTestId("lookup-bar-vocab")).toBeInTheDocument(); // word, not sentence
    touch(screen.getByTestId("ctx"), "pointerup");
  });

  it("a mouse press selects nothing", async () => {
    mount();
    touch(screen.getByTestId("ctx"), "pointerdown", "mouse");
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
    expect(window.getSelection()!.toString()).toBe("");
  });
});
