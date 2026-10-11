import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const flags = (...on: string[]): LinkFlags =>
  ({ enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, on.includes(k)])) as LinkFlags["links"] });
const ON = flags("chat_words", "daily_tasks");
const TODAY = { today: [{ word: "talk", used: true }, { word: "carry", used: false }, { word: "brew", used: false }], used_count: 1 };

function client(body: unknown = TODAY) {
  const mock = createFetchMock({ "GET /api/links/chat-words": () => json(body) });
  return { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), calls: mock.calls };
}

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("对话用今日词", () => {
  it("renders nothing and fetches nothing while the link is off", () => {
    const { api, calls } = client();
    setLinkFlags(flags("daily_tasks"));
    const { container } = renderWithProviders(
      <><Slot point="dailyTasks" props={{ today: null }} /><Slot point="wordDetailSections" props={{ word: "talk" }} /></>, { api });
    expect(container.querySelector("[data-testid='daily-task-chat-words.task'], [data-testid=chat-words-badge]")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("shows the daily task row with used/target and links to chat", async () => {
    setLinkFlags(ON);
    const { api, calls } = client();
    renderWithProviders(<Slot point="dailyTasks" props={{ today: null }} />, { api });
    const row = await screen.findByTestId("daily-task-chat-words.task");
    expect(row).toHaveTextContent("对话用今日词");
    expect(row).toHaveTextContent("1/3");
    expect(row).toHaveAttribute("data-state", "todo");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/chat");
    expect(calls[0].url.searchParams.has("offset")).toBe(true);
  });

  it("is done when the used count reaches min(3, today) and hidden without today's words", async () => {
    setLinkFlags(ON);
    renderWithProviders(<Slot point="dailyTasks" props={{ today: null }} />,
      { api: client({ today: [{ word: "talk", used: true }], used_count: 1 }).api });
    const row = await screen.findByTestId("daily-task-chat-words.task");
    expect(row).toHaveAttribute("data-state", "done");
    expect(row).toHaveTextContent("1/1");
    expect(screen.getByRole("link", { name: /已完成/ })).toBeInTheDocument();

    const empty = client({ today: [], used_count: 0 });
    const { container } = renderWithProviders(<Slot point="dailyTasks" props={{ today: null }} />, { api: empty.api });
    await waitFor(() => expect(empty.calls).toHaveLength(1));
    await Promise.resolve();
    expect(container.querySelector("[data-testid='daily-task-chat-words.task']")).toBeNull();
  });

  it("badges a word on the word card only when it was used in chat today; one request is shared", async () => {
    setLinkFlags(ON);
    const { api, calls } = client();
    renderWithProviders(
      <>
        <div data-testid="talk"><Slot point="wordDetailSections" props={{ word: "talk" }} /></div>
        <div data-testid="carry"><Slot point="wordDetailSections" props={{ word: "carry" }} /></div>
      </>, { api });
    await waitFor(() => expect(screen.getByTestId("talk")).toHaveTextContent("今天在对话里用过"));
    expect(screen.getByTestId("chat-words-badge").querySelector(".bg-teal-tint.text-teal")).not.toBeNull();
    expect(screen.getByTestId("carry")).toBeEmptyDOMElement();
    expect(calls).toHaveLength(1);
  });

  it("stays silent when the request fails", async () => {
    setLinkFlags(ON);
    const mock = createFetchMock({ "GET /api/links/chat-words": () => json({ error: "Link is off" }, 404) });
    const { container } = renderWithProviders(<Slot point="dailyTasks" props={{ today: null }} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await Promise.resolve();
    expect(container.querySelector("[data-testid='daily-task-chat-words.task']")).toBeNull();
  });
});
