import { configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PersonaRadioList } from "./persona-radio-list";
import { resetAgentsCaches } from "./use-agents-data";

const persona = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, builtin: id.startsWith("builtin:"), mine: !id.startsWith("builtin:"), name, intro: `${name} intro`, prompt: null as string | null, level: "B1", style: "friendly",
  voice: null as string | null, tools: [] as string[], prompt_public: true, deep_think: false, disabled: false, created_at: null as string | null, updated_at: null as string | null, ...extra,
});
const AGENTS_ON = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 }, levels: ["B1"], styles: ["friendly"], tools: [] as string[] };

function mount(props: Partial<React.ComponentProps<typeof PersonaRadioList>> = {}, config: Record<string, unknown> = AGENTS_ON) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(config),
    "GET /api/agents/personas": () => json({ personas: [persona("builtin:partner", "Partner"), persona("builtin:coach", "Emma"), persona("u1", "Mine", { disabled: true })] }),
  });
  const onSelect = vi.fn();
  renderWithProviders(<PersonaRadioList selectedId="builtin:partner" onSelect={onSelect} {...props} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onSelect };
}

// the full suite runs these on a loaded machine: give async queries more than the 1 s default
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => resetAgentsCaches());

describe("PersonaRadioList", () => {
  it("renders a radiogroup with the selected persona checked and the picker's testids", async () => {
    mount({ heading: "Persona" });
    expect(await screen.findByTestId("agent-persona-builtin:partner")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radiogroup", { name: "Persona for this chat" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-persona-builtin:coach")).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("Persona")).toBeInTheDocument();
  });

  it("selects another persona on click, ignores the checked one, and skips disabled personas", async () => {
    const { onSelect } = mount();
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:coach"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "builtin:coach" }));
    onSelect.mockClear();
    await userEvent.click(screen.getByTestId("agent-persona-builtin:partner"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("agent-persona-u1")).toBeDisabled();
  });

  it("moves with the arrow keys (roving tabindex)", async () => {
    const { onSelect } = mount();
    const first = await screen.findByTestId("agent-persona-builtin:partner");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("agent-persona-builtin:coach")).toHaveAttribute("tabindex", "-1");
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "builtin:coach" }));
  });

  it("is disabled as a whole while a guided lesson runs", async () => {
    mount({ disabled: true });
    await screen.findByTestId("agent-persona-builtin:coach");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  it("shows the more row only when asked and calls it", async () => {
    const onMore = vi.fn();
    mount({ onMore });
    await userEvent.click(await screen.findByTestId("agent-persona-more"));
    expect(onMore).toHaveBeenCalled();
  });

  it("renders nothing, heading included, when agents are switched off", async () => {
    const { mock } = mount({ heading: "Persona", onMore: vi.fn() }, { ...AGENTS_ON, enabled: false });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/agents/config")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("agent-persona-radio-list")).toBeNull();
    expect(screen.queryByText("Persona")).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname === "/api/agents/personas")).toBe(false);
  });
});
