import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { blurLayers, setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { ChatHubLayout, type ChatHubSection } from "./chat-hub";

const config = (enabled: boolean): Record<string, Handler> => ({
  "GET /api/rooms/config": () => json({ enabled, ai_available: false, max_members: 8, max_text: 500 }),
});

/** 页面替身:渲染 embedded.switcher,并把收到的标题打在页面上(未开启时为 none,即页面拿到的是 undefined)。 */
function Probe({ section }: { section: ChatHubSection }) {
  return (
    <ChatHubLayout section={section}>
      {(embedded) => (
        <>
          {embedded?.switcher}
          <p data-testid="probe">{embedded ? `title:${embedded.title ?? "own"}` : "none"}</p>
        </>
      )}
    </ChatHubLayout>
  );
}

function setup(section: ChatHubSection, routes: Record<string, Handler>, route = `/${section === "chat" ? "chat" : "rooms"}`) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = renderWithProviders(<Probe section={section} />, { api, route, path: "*" });
  return { mock, api, ...view };
}

const locationText = () => screen.getByTestId("location").textContent;

describe("ChatHubLayout", () => {
  beforeEach(() => localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })));
  afterEach(async () => {
    setLiquid(false);
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
  });

  it("shows the switch with 对话 selected on /chat and hands the title to the page", async () => {
    setup("chat", config(true));
    expect(await screen.findByTestId("chat-hub-switch")).toBeInTheDocument();
    expect(screen.getByTestId("hub-tab-chat")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("hub-tab-rooms")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("probe")).toHaveTextContent("title:对话");
  });

  it("replaces the history entry when a section is picked, so back leaves the chat area (plan L6 R6)", async () => {
    const mock = createFetchMock(config(true));
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    function Harness() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" data-testid="go-chat" onClick={() => navigate("/chat")}>go</button>
          <button type="button" data-testid="go-back" onClick={() => navigate(-1)}>back</button>
          <Probe section="chat" />
        </>
      );
    }
    renderWithProviders(<Harness />, { api, route: "/practice", path: "*" });
    fireEvent.click(screen.getByTestId("go-chat"));
    expect(locationText()).toBe("/chat");
    fireEvent.click(await screen.findByTestId("hub-tab-rooms"));
    await waitFor(() => expect(locationText()).toBe("/rooms"));
    fireEvent.click(screen.getByTestId("go-back"));
    await waitFor(() => expect(locationText()).toBe("/practice"));
  });

  it("moves to the rooms section with the arrow keys", async () => {
    setup("chat", config(true));
    const chat = await screen.findByTestId("hub-tab-chat");
    chat.focus();
    fireEvent.keyDown(chat, { key: "ArrowRight" });
    await waitFor(() => expect(locationText()).toBe("/rooms"));
  });

  it("selects 联机 on /rooms", async () => {
    setup("rooms", config(true));
    expect(await screen.findByTestId("hub-tab-rooms")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("hub-tab-chat")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("probe")).toHaveTextContent("title:对话");
  });

  it("keeps the page's own title on the ended page and still selects 联机", async () => {
    setup("rooms-ended", config(true), "/rooms/ended");
    expect(await screen.findByTestId("hub-tab-rooms")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("probe")).toHaveTextContent("title:own");
  });

  it("gives the page nothing when rooms are off, and no switch", async () => {
    setup("chat", config(false));
    expect(await screen.findByTestId("probe")).toHaveTextContent("none");
    expect(screen.queryByTestId("chat-hub-switch")).toBeNull();
    expect(screen.queryByTestId("hub-tab-chat")).toBeNull();
  });

  it("gives the page nothing when the config request fails", async () => {
    setup("chat", { "GET /api/rooms/config": () => json({ error: "Upstream unavailable" }, 502) });
    expect(await screen.findByTestId("probe")).toHaveTextContent("none");
    expect(screen.queryByTestId("chat-hub-switch")).toBeNull();
  });

  it("renders the switch on the first frame of a second mount with the same client, and asks once", async () => {
    const { mock, api, unmount } = setup("chat", config(true));
    await screen.findByTestId("chat-hub-switch");
    unmount();
    renderWithProviders(<Probe section="chat" />, { api, route: "/chat", path: "*" });
    expect(screen.getByTestId("chat-hub-switch")).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.url.pathname === "/api/rooms/config")).toHaveLength(1);
  });

  it("adds no blurred layer for the switch in the liquid skin", async () => {
    setLiquid(true);
    setup("chat", config(true));
    const sw = await screen.findByTestId("chat-hub-switch");
    expect(blurLayers(sw)).toHaveLength(0);
  });

  it("labels the switch in Chinese and English", async () => {
    setup("chat", config(true));
    expect(await screen.findByTestId("hub-tab-chat")).toHaveTextContent("AI 对话");
    expect(screen.getByTestId("hub-tab-rooms")).toHaveTextContent("联机");
    await i18n.changeLanguage("en");
    expect(screen.getByTestId("hub-tab-chat")).toHaveTextContent("AI chat");
    expect(screen.getByTestId("hub-tab-rooms")).toHaveTextContent("Rooms");
  });
});
