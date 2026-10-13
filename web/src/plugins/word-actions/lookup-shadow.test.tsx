import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { LookupLayer } from "~/features/lookup";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "word_actions"])) as LinkFlags["links"] };

beforeEach(async () => {
  indexedDB.deleteDatabase("enjoy-web");
  resetKvCacheForTests();
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("shadowing from the lookup sheet closes the panel and the lookup sheet, and opens the shadow sheet", async () => {
  setLinkFlags(ON);
  const mock = createFetchMock({
    "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","pos":"noun","definition":"a nation","translation":"国家"}' } }] }),
    "GET /api/wordbook/config": () => json({ enabled: false }),
  });
  renderWithProviders(
    <WithShadowSheet>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </WithShadowSheet>,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1" },
  );
  const node = screen.getByTestId("ctx").firstChild!;
  await act(async () => {
    const range = document.createRange();
    const start = node.textContent!.indexOf("country");
    range.setStart(node, start);
    range.setEnd(node, start + "country".length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await userEvent.click(await screen.findByTestId("lookup-trigger"));
  await userEvent.click(await screen.findByTestId("lookup-vocab-more"));
  await userEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
  expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("shadow-reference")).toHaveTextContent("ask not what your country can do for you");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/chat\/c1$/); // 没有导航
  expect(screen.getByTestId("location").dataset.state).toBe("null");
  await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull()); // 查词抽屉被收起
  expect(screen.queryByRole("dialog", { name: "单词操作" })).toBeNull(); // 面板先关
});
