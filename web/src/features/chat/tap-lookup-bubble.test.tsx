import "fake-indexeddb/auto";
import { screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { LookupLayer } from "~/features/lookup";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { TestPointerEvent, stubCaret, tapAt, unstubCaret } from "~/test/tap-lookup";
import { MessageBubble } from "./message-bubble";
import type { UiMessage } from "./ui-message";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const TEXT = "Nice to meet you, traveller.";
const reply: UiMessage = { key: "a1", role: "assistant", status: "done", content: TEXT };

beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });
afterEach(() => { unstubCaret(); window.getSelection()?.removeAllRanges(); });

describe("tap-to-lookup on a chat bubble", () => {
  it("one tap selects the word and shows the lookup bar", async () => {
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) });
    renderWithProviders(<><MessageBubble message={reply} /><LookupLayer /></>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const textNode = screen.getByText(TEXT).firstChild!;
    stubCaret(textNode, TEXT.indexOf("traveller") + 3);
    tapAt(screen.getByText(TEXT));
    expect(window.getSelection()!.toString()).toBe("traveller");
    expect(await screen.findByTestId("lookup-bar")).toBeInTheDocument();
  });
});
