import "fake-indexeddb/auto";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CallCaptionTranslation, readAutoTranslate, writeAutoTranslate } from "./call-caption-translation";

const reply = (content: string) => json({ choices: [{ message: { content } }] });
const calls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/ai/chat/completions").length;

type Props = Parameters<typeof CallCaptionTranslation>[0];
/** renderWithProviders 的 rerender 会换掉整棵树(重新挂载),所以用一个自带状态的壳来改 props。 */
let patch: (p: Partial<Props>) => void = () => undefined;
function Harness(initial: Props) {
  const [props, setProps] = useState(initial);
  patch = (p) => setProps((prev) => ({ ...prev, ...p }));
  return <CallCaptionTranslation {...props} />;
}

function setup(handler: () => Response | Promise<Response> = () => reply("你好")) {
  const mock = createFetchMock({ "POST /api/ai/chat/completions": handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  return { mock, api };
}

describe("CallCaptionTranslation", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); window.localStorage.clear(); });

  it("shows the translate button only for a finished caption", () => {
    const { api } = setup();
    renderWithProviders(<Harness api={api} nativeLanguage="zh-CN" captionKey="a-1" text="Hi" finished={false} auto={false} />);
    expect(screen.queryByTestId("call-caption-translate")).toBeNull();
    act(() => patch({ finished: true }));
    expect(screen.getByTestId("call-caption-translate")).toBeInTheDocument();
  });

  it("toggles the translation line on and off without refetching", async () => {
    const { api, mock } = setup();
    renderWithProviders(<CallCaptionTranslation api={api} nativeLanguage="zh-CN" captionKey="a-1" text="Hello" finished auto={false} />);
    const btn = screen.getByTestId("call-caption-translate");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("message-translation")).toHaveTextContent("你好"));
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(screen.queryByTestId("message-translation")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("message-translation")).toHaveTextContent("你好");
    expect(calls(mock)).toBe(1);
  });

  it("auto mode translates a finished caption exactly once, even after hiding and re-rendering", async () => {
    const { api, mock } = setup();
    renderWithProviders(<Harness api={api} nativeLanguage="zh-CN" captionKey="a-1" text="Hello" finished auto />);
    await waitFor(() => expect(screen.getByTestId("message-translation")).toHaveTextContent("你好"));
    fireEvent.click(screen.getByTestId("call-caption-translate")); // hide
    act(() => patch({ text: "Hello" }));
    expect(screen.queryByTestId("message-translation")).toBeNull();
    expect(calls(mock)).toBe(1);
  });

  it("auto mode does not translate while the caption is still streaming", async () => {
    const { api, mock } = setup();
    renderWithProviders(<Harness api={api} nativeLanguage="zh-CN" captionKey="a-1" text="He" finished={false} auto />);
    await act(async () => { await Promise.resolve(); });
    expect(calls(mock)).toBe(0);
    act(() => patch({ text: "Hello", finished: true }));
    await waitFor(() => expect(calls(mock)).toBe(1));
  });

  it("layout places the button and the translation line (both null while streaming)", async () => {
    const { api } = setup();
    const layout = (button: React.ReactNode, line: React.ReactNode) => (
      <div data-testid="card"><div data-testid="head">{button}</div><p>Hello</p><div data-testid="foot">{line}</div></div>
    );
    renderWithProviders(<Harness api={api} nativeLanguage="zh-CN" captionKey="a-1" text="Hello" finished={false} auto={false} layout={layout} />);
    expect(screen.getByTestId("card")).toBeInTheDocument(); // 卡片照常渲染
    expect(screen.queryByTestId("call-caption-translate")).toBeNull();
    act(() => patch({ finished: true }));
    expect(screen.getByTestId("head")).toContainElement(screen.getByTestId("call-caption-translate"));
    fireEvent.click(screen.getByTestId("call-caption-translate"));
    await waitFor(() => expect(screen.getByTestId("foot")).toHaveTextContent("你好"));
    expect(screen.getByTestId("message-translation")).toHaveAttribute("data-status", "done");
  });

  it("ignores a late answer after unmount (no state update, no error)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api, mock } = setup(async () => { await gate; return reply("迟到"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = renderWithProviders(<CallCaptionTranslation api={api} nativeLanguage="zh-CN" captionKey="a-1" text="Hello" finished auto />);
    await waitFor(() => expect(calls(mock)).toBe(1));
    view.unmount();
    release();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("auto-translate setting", () => {
  beforeEach(() => window.localStorage.clear());
  it("persists in localStorage and tolerates storage failures", () => {
    expect(readAutoTranslate()).toBe(false);
    writeAutoTranslate(true);
    expect(readAutoTranslate()).toBe(true);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readAutoTranslate()).toBe(false);
    spy.mockRestore();
  });
});
