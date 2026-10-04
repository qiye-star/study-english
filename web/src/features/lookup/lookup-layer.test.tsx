import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LookupLayer } from "./lookup-layer";

function Page() {
  return (
    <>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <p data-testid="plain">plain text here</p>
      <LookupLayer />
    </>
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
    expect(mock.calls).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    expect(mock.calls).toHaveLength(2);
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
    expect(JSON.parse(mock.calls[1].body as string).response_format).toBeUndefined();
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
});
