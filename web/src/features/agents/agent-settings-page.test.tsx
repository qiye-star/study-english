import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AgentSettingsPage } from "./agent-settings-page";
import { resetAgentsCaches } from "./use-agents-data";

const CONFIG = {
  enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 },
};
const SETTINGS = {
  tools: { lookup: true, learned_words: true, weak_words: true, due_words: true, memory: true },
  memory_enabled: true, share_in_rooms: true, show_process: true, default_persona_id: "builtin:coach", tutor: { length: 8, mix: ["ask", "words"] },
  process_default: "collapsed",
};
const COACH: Record<string, unknown> = { id: "builtin:coach", builtin: true, mine: false, name: "Emma", intro: "Coach", prompt: null, level: "B1", style: "friendly", voice: null,
  tools: ["lookup"], prompt_public: true, deep_think: false, disabled: false, created_at: null, updated_at: null };
const PERSONAS = { personas: [COACH] };

function setup(extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(CONFIG),
    "GET /api/agents/settings": () => json(SETTINGS),
    "GET /api/agents/personas": () => json(PERSONAS),
    ...extra,
  });
  renderWithProviders(<AgentSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/me/agents" });
  return mock;
}

describe("AgentSettingsPage (spec §4.3, D2)", () => {
  beforeEach(() => resetAgentsCaches());

  it("shows every global tool on, the default persona, the room warning and the memory link", async () => {
    setup();
    for (const key of ["lookup", "learned_words", "weak_words", "due_words", "memory"]) {
      expect(await screen.findByTestId(`agent-setting-tool-${key}`)).toHaveAttribute("data-state", "checked");
    }
    expect(screen.getByTestId("agent-setting-default-persona")).toHaveTextContent("Emma");
    expect(screen.getByText(/Replies in a room are visible to everyone/)).toBeInTheDocument();
    expect(screen.getByTestId("agent-setting-memory-manage")).toHaveAttribute("href", "/me/agents/memory");
    expect(screen.getByTestId("agent-setting-tutor-length")).toHaveValue("8");
  });

  it("saves a switch optimistically as snake_case and rolls back when saving fails", async () => {
    let fail = false;
    const mock = setup({ "PATCH /api/agents/settings": (call) => (fail ? json({ error: "x" }, 500) : json({ ...SETTINGS, ...JSON.parse(String(call.body)) })) });
    const show = await screen.findByTestId("agent-setting-show-process");
    await userEvent.click(show);
    await waitFor(() => expect(show).toHaveAttribute("data-state", "unchecked"));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ show_process: false });
    fail = true;
    await userEvent.click(screen.getByTestId("agent-setting-tool-weak_words"));
    await waitFor(() => expect(screen.getByTestId("agent-setting-tool-weak_words")).toHaveAttribute("data-state", "checked"));
    expect(JSON.parse(String(mock.calls.filter((c) => c.method === "PATCH")[1].body))).toEqual({ tools: { weak_words: false } });
  });

  it("keeps at least one tutor question type", async () => {
    const mock = setup({ "PATCH /api/agents/settings": (call) => json({ ...SETTINGS, ...JSON.parse(String(call.body)) }) });
    await userEvent.click(await screen.findByTestId("agent-setting-kind-words"));
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    expect(screen.getByTestId("agent-setting-kind-ask")).toBeDisabled();
  });

  it("explains when agents are off", async () => {
    setup({ "GET /api/agents/config": () => json({ enabled: false }) });
    expect(await screen.findByText("Agents are not enabled on this server.")).toBeInTheDocument();
  });
});
