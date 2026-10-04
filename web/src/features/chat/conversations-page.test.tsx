import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationsPage } from "./conversations-page";

const CONFIG_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const conv = (id: string, name: string) => ({ id, name, config: {}, created_at: "2026-10-04T00:00:00+00:00", updated_at: "2026-10-04T00:00:00+00:00" });

describe("ConversationsPage", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("creates a conversation with server defaults and opens it", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "New conversation")),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    expect(await screen.findByTestId("conversations-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-new"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    const body = JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string);
    expect(body.config).toMatchObject({ model: "gpt-4o", tts_model: "openai/tts-1", tts_voice: "alloy", temperature: 0.7 });
  });

  it("lists and deletes conversations", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [conv("c1", "Trip"), conv("c2", "New conversation")], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => json({ id: "c1" }),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    const items = await screen.findAllByTestId("conversation-item");
    expect(items[0]).toHaveTextContent("Trip");
    expect(items[1]).toHaveTextContent("Untitled conversation");
    await userEvent.click(screen.getAllByTestId("conversation-delete")[0]);
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("conversation-item")).toHaveLength(1));
  });
});
