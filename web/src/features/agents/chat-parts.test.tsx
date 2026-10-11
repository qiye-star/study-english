import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChatPersonaControl, TUTOR_SLOTS, TutorEntry } from "./chat-parts";
import { resetAgentsCaches } from "./use-agents-data";

const persona = (id: string, name: string) => ({ id, builtin: true, mine: false, name, intro: "", prompt: null as string | null, level: "B1", style: "friendly", voice: null as string | null,
  tools: ["lookup"], prompt_public: true, deep_think: false, disabled: false, created_at: null as string | null, updated_at: null as string | null });
const config = (enabled: boolean, tutor = true) => ({ enabled, available: true, tutor, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 } });

function setup(enabled: boolean, personaId: string | null) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(config(enabled)),
    "GET /api/agents/personas": () => json({ personas: [persona("builtin:coach", "Emma"), persona("builtin:waiter", "Mia")] }),
  });
  const onChange = vi.fn();
  const onResolved = vi.fn();
  renderWithProviders(<ChatPersonaControl personaId={personaId} disabled={false} onChange={onChange} onResolved={onResolved} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onChange, onResolved };
}

describe("ChatPersonaControl (spec §9.3, R-W15)", () => {
  beforeEach(() => resetAgentsCaches());

  it("renders nothing when agents are off", async () => {
    const { mock } = setup(false, null);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("agent-persona-chip")).toBeNull();
  });

  it("shows the conversation's persona, reports it, and changes it through the picker", async () => {
    const { onChange, onResolved } = setup(true, "builtin:coach");
    const chip = await screen.findByTestId("agent-persona-chip");
    await waitFor(() => expect(chip).toHaveTextContent("Emma"));
    expect(onResolved).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Emma" }));
    await userEvent.click(chip);
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:waiter"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "builtin:waiter" }));
  });

  it("offers a persona to an old conversation and does not fire for the same choice", async () => {
    const { onChange } = setup(true, null);
    const chip = await screen.findByTestId("agent-persona-chip");
    expect(chip).toHaveTextContent("Persona");
    await userEvent.click(chip);
    await userEvent.click(await screen.findByTestId("agent-persona-none"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TutorEntry (R-W18, INDEX X7: the tutor components are a slot, not an import)", () => {
  beforeEach(() => {
    resetAgentsCaches();
    TUTOR_SLOTS.StartSheet = ({ open, onStarted }) =>
      open ? <button type="button" data-testid="fake-tutor-start" onClick={() => onStarted("ts1")}>start</button> : null;
  });
  afterEach(() => { TUTOR_SLOTS.StartSheet = null; });
  const render = (personaId: string | null, tutor = true) => {
    const onStarted = vi.fn();
    renderWithProviders(<TutorEntry personaId={personaId} conversationId="c1" disabled={false} onStarted={onStarted} />, { api: new ApiClient({
      getToken: () => "t", fetchImpl: createFetchMock({ "GET /api/agents/config": () => json(config(true, tutor)) }).fetch,
    }) });
    return onStarted;
  };

  it("opens the slot's start sheet and hands over the session id", async () => {
    const onStarted = render("builtin:coach");
    await userEvent.click(await screen.findByTestId("agent-tutor-entry"));
    await userEvent.click(await screen.findByTestId("fake-tutor-start"));
    expect(onStarted).toHaveBeenCalledWith("ts1");
    expect(screen.queryByTestId("fake-tutor-start")).toBeNull();
  });

  it("is hidden without a persona, when the tutor is off, or while the slot is empty", async () => {
    render(null);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("agent-tutor-entry")).toBeNull();
    cleanup();
    render("builtin:coach", false);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("agent-tutor-entry")).toBeNull();
    cleanup();
    TUTOR_SLOTS.StartSheet = null;
    render("builtin:coach");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("agent-tutor-entry")).toBeNull();
  });
});
