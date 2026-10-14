import "fake-indexeddb/auto";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { useShadowSheet } from "~/features/practice";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const aiCalls = (mock: { calls: Array<{ url: URL; body?: unknown }> }) => mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions");

function Page() {
  return (
    <WithShadowSheet>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <p data-testid="plain">plain text here</p>
      <LookupLayer />
    </WithShadowSheet>
  );
}

async function selectText(needle: string, testId = "ctx") {
  const node = screen.getByTestId(testId).firstChild!;
  const start = node.textContent!.indexOf(needle);
  await act(async () => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("LookupLayer", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });

  it("looks up a selected word, switches to translation and reuses the cache", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": (call) => {
        const body = JSON.parse(call.body as string);
        return body.response_format
          ? json({ choices: [{ message: { content: '{"word":"country","pos":"noun","definition":"a nation","translation":"国家"}' } }] })
          : json({ choices: [{ message: { content: "国家" } }] });
      },
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("lookup-result")).toHaveTextContent("a nation");
    await userEvent.click(screen.getByTestId("lookup-switch-mode"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("国家"));
    expect(aiCalls(mock)).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(aiCalls(mock)).toHaveLength(2);
  });

  it("translates long selections and offers retry on errors", async () => {
    let fail = true;
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => (fail ? json({ error: "Upstream unavailable" }, 502) : json({ choices: [{ message: { content: "不要问" } }] })),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "error"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upstream unavailable");
    fail = false;
    await userEvent.click(screen.getByTestId("lookup-retry"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("不要问"));
    expect(JSON.parse(aiCalls(mock)[1].body as string).response_format).toBeUndefined();
  });

  it("offers no trigger for selections outside lookup regions", async () => {
    const mock = createFetchMock({});
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("plain", "plain");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId("lookup-trigger")).toBeNull();
  });

  it("closing the drawer mid-request ignores the late response without errors", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let release: () => void = () => {};
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => new Promise((resolve) => {
        release = () => resolve(json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }));
      }),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "loading");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByTestId("lookup-result")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("positions the overlay and the drawer against the viewport (both fixed)", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }) });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    const overlay = await screen.findByTestId("sheet-overlay");
    const drawer = screen.getByTestId("lookup-drawer");
    for (const el of [overlay, drawer]) {
      expect(el.className).toMatch(/(^| )fixed( |$)/);
      expect(el.className).not.toMatch(/(^| )absolute( |$)/);
    }
  });

  it("ignores text selected inside the open drawer", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }) });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    const callsBefore = mock.calls.length;
    const node = screen.getByText("a nation").firstChild!;
    await act(async () => {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 6);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(screen.queryByTestId("lookup-trigger")).toBeNull();
    expect(screen.getByTestId("lookup-drawer")).toBeInTheDocument();
    expect(mock.calls.length).toBe(callsBefore);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId("lookup-trigger")).toBeNull();
  });

  it("offers practice and save for a selected sentence only", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: "不要问国家能为你做什么" } }] }),
      "POST /api/practice-items": () => json({ id: "p1", text: "x", source: "lookup", created_at: "t" }),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("lookup-save"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/practice-items")!.body as string))
      .toEqual({ text: "ask not what your country can do", source: "lookup" });
    await userEvent.click(screen.getByTestId("lookup-practice"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("ask not what your country can do");
    expect(screen.queryByTestId("shadow-position")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/); // 没有导航
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull()); // 先关查词面板
  });

  it("collapses the drawer when the shadow sheet opens from somewhere else", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }) });
    function OpenElsewhere() {
      const { open } = useShadowSheet();
      return <button type="button" data-testid="open-elsewhere" onClick={() => open({ text: "Hello there.", source: "manual" })}>x</button>;
    }
    // 不用 Page(它自带一层 WithShadowSheet):两个 Provider 不同步。这里只有外面这一层。
    renderWithProviders(
      <WithShadowSheet>
        <OpenElsewhere />
        <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
        <LookupLayer />
      </WithShadowSheet>,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
    );
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    // 抽屉是模态的(body 带 pointer-events:none),userEvent 点不到外面的按钮;这里模拟「从别处打开」,直接触发 click
    await act(async () => { screen.getByTestId("open-elsewhere").click(); });
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
  });

  it("does not offer practice for a single word", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }) });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.queryByTestId("lookup-practice")).toBeNull();
    expect(screen.queryByTestId("lookup-save")).toBeNull();
  });

  it("guards double saves and shows a translated error when saving fails", async () => {
    let release: () => void = () => {};
    let fail = false;
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: "译文" } }] }),
      "POST /api/practice-items": () => new Promise((resolve) => {
        release = () => resolve(fail ? json({ error: "Upstream unavailable" }, 500) : json({ id: "p1", text: "x", source: "lookup", created_at: "t" }));
      }),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("lookup-save"));
    expect(screen.getByTestId("lookup-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("lookup-save"));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(mock.calls.filter((c) => c.url.pathname === "/api/practice-items")).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("lookup-save")).not.toBeDisabled());
    fail = true;
    vi.mocked(toast.error).mockClear();
    await userEvent.click(screen.getByTestId("lookup-save"));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toContain("Upstream unavailable");
  });

  it("adds a looked-up word to the vocabulary book with its meaning and sentence", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","pos":"noun","definition":"a nation","translation":"国家"}' } }] }),
      "POST /api/vocabulary": () => json({ id: "v1" }),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("lookup-vocab"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/vocabulary")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string)).toEqual({
      word: "country", meaning: "noun · 国家 · a nation", example: "ask not what your country can do for you", source: "lookup",
    });
    expect(toast.success).toHaveBeenCalledWith("Added to your vocabulary.");
  });

  it("offers no vocabulary button for a sentence translation", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: "不要问" } }] }) });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.queryByTestId("lookup-vocab")).toBeNull();
  });

  it("offers no vocabulary button for a sentence switched to look up instead", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": (call) => (JSON.parse(call.body as string).response_format
        ? json({ choices: [{ message: { content: '{"word":"ask not what your country can do","definition":"a quote"}' } }] })
        : json({ choices: [{ message: { content: "不要问国家能为你做什么" } }] })),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await selectText("ask not what your country can do");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("lookup-switch-mode"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveTextContent("a quote"));
    expect(screen.queryByTestId("lookup-vocab")).toBeNull();
  });
});

describe("LookupLayer: a press on the bar survives Android collapsing the native selection", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });
  const collapse = async () => {
    await act(async () => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((r) => setTimeout(r, 400)); // longer than the 300 ms debounce
    });
  };
  const mountMock = () => {
    const mock = createFetchMock({
      "POST /api/dictionary/lookup": () => json({ hit: false }),
      "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","pos":"noun","definition":"a nation","translation":"国家"}' } }] }),
    });
    renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  };

  it("touch press, selection collapses, release, click: the bar stays and the lookup opens", async () => {
    mountMock();
    await selectText("country");
    const trigger = await screen.findByTestId("lookup-trigger");
    fireEvent.touchStart(trigger);
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    await collapse(); // what Chrome on Android does to the selection while the finger is down
    expect(screen.getByTestId("lookup-bar")).toBeInTheDocument();
    fireEvent.pointerUp(trigger, { pointerType: "touch" });
    fireEvent.touchEnd(trigger);
    await collapse(); // a late collapse right after release, before the click lands
    expect(screen.getByTestId("lookup-bar")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByTestId("lookup-drawer")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("lookup-drawer")).toHaveTextContent("country"); // opened with the latched selection
  });

  it("a collapse with no press on the bar still hides it (tap elsewhere)", async () => {
    mountMock();
    await selectText("country");
    await screen.findByTestId("lookup-bar");
    await collapse();
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
  });

  it("a press that never turns into a click lets go: the bar hides once the selection is really gone", async () => {
    mountMock();
    await selectText("country");
    const trigger = await screen.findByTestId("lookup-trigger");
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    await collapse();
    fireEvent.pointerCancel(trigger, { pointerType: "touch" });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
  });

  it("the bar is not text-selectable (a press cannot start a new selection)", async () => {
    mountMock();
    await selectText("country");
    expect(await screen.findByTestId("lookup-bar")).toHaveClass("select-none");
  });
});
