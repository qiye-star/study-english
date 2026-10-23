import "fake-indexeddb/auto";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetAgentsCaches } from "~/features/agents/use-agents-data";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { ConversationChrome } from "./conversation-chrome";
import { ConversationPage } from "./conversation-page";

const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

function routes(id = "c1"): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    [`GET /api/conversations/${id}`]: () => json({ id, name: "Trip", config: CONFIG }),
    [`GET /api/conversations/${id}/messages`]: () => json({ messages: [{ id: "m0", conversation_id: id, role: "assistant", content: "Earlier reply" }] }),
    "GET /api/realtime/config": () => json({ enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    "GET /api/agents/config": () => json({ enabled: false, available: false }),
    "GET /api/agents/personas": () => json({ personas: [] }),
  };
}

function setup(props: Parameters<typeof ConversationPage>[0] = {}, route = "/chat/c1", extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({ ...routes(), ...extra });
  renderWithProviders(<ConversationPage {...props} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route, path: "/chat/:id" });
  return mock;
}

beforeAll(() => {
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});
beforeEach(() => { resetServerAiConfigCache(); resetAgentsCaches(); });

describe("classic chrome (default props)", () => {
  it("keeps the back button and the options popover with the same testids", async () => {
    setup();
    await screen.findByText("Earlier reply");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-options"));
    const panel = await screen.findByTestId("conversation-options-panel");
    for (const id of ["conversation-autospeak", "conversation-speed", "conversation-recap", "conversation-settings"]) {
      expect(within(panel).getByTestId(id)).toBeInTheDocument();
    }
  });
});

describe("chrome slots", () => {
  it("conversationId wins over the route param and the custom chrome replaces the classic one", async () => {
    const onLoaded = vi.fn();
    const chrome: ConversationChrome = {
      renderLeading: () => <span data-testid="x-leading" />,
      renderActions: (ctl) => <button type="button" data-testid="x-call" ref={ctl.callState.callButtonRef} onClick={ctl.startCall}>call</button>,
      renderTitle: () => ({ title: "Today", subtitle: "Partner" }),
      beforeMessages: () => <p data-testid="x-before" />,
      renderMessage: (m, node) => <div data-testid="x-wrap" data-id={m.id}>{node}</div>,
      onLoaded,
    };
    const mock = setup({ conversationId: "c2", chrome }, "/chat/other", routes("c2"));
    await screen.findByText("Earlier reply");
    expect(mock.calls.some((c) => c.url.pathname === "/api/conversations/c2")).toBe(true);
    expect(mock.calls.some((c) => c.url.pathname === "/api/conversations/other")).toBe(false);
    expect(screen.getByTestId("x-leading")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-options")).toBeNull();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByTestId("x-before")).toBeInTheDocument();
    expect(screen.getByTestId("x-wrap")).toHaveAttribute("data-id", "m0");
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0][0]).toMatchObject({ id: "c2" });
  });

  it("emptyState renders only for a loaded conversation without messages", async () => {
    const chrome: ConversationChrome = {
      renderLeading: () => null, renderActions: () => null, emptyState: () => <p data-testid="x-empty">nothing yet</p>,
    };
    setup({ chrome }, "/chat/c1", { "GET /api/conversations/c1/messages": () => json({ messages: [] }) });
    expect(await screen.findByTestId("x-empty")).toBeInTheDocument();
  });
});
