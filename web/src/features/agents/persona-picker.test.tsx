import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PersonaPicker } from "./persona-picker";
import { resetAgentsCaches } from "./use-agents-data";

const persona = (id: string, name: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, builtin: id.startsWith("builtin:"), mine: !id.startsWith("builtin:"), name, intro: `${name} intro`, prompt: null, level: "B1", style: "friendly",
  voice: null, tools: ["lookup"], prompt_public: true, deep_think: false, disabled: false, created_at: null, updated_at: null, ...over,
});
const LIST = [persona("builtin:coach", "Emma"), persona("builtin:interviewer", "Jack", { disabled: true }), persona("p1", "Quiz")];

function setup(props: Partial<React.ComponentProps<typeof PersonaPicker>> = {}, max = 10) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json({
      enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
      limits: { personas_max: max, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 },
    }),
    "GET /api/agents/personas": () => json({ personas: LIST }),
  });
  const onSelect = vi.fn();
  renderWithProviders(<PersonaPicker open onOpenChange={() => undefined} selectedId="builtin:coach" onSelect={onSelect} allowNone {...props} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onSelect };
}

describe("PersonaPicker (mockup 5)", () => {
  beforeEach(() => resetAgentsCaches());

  it("lists built-in and my personas with badges, filters by tab and marks the selected one", async () => {
    setup();
    const emma = await screen.findByTestId("agent-persona-builtin:coach");
    expect(emma).toHaveAttribute("aria-checked", "true");
    expect(emma).toHaveTextContent("Built-in");
    expect(screen.getByTestId("agent-persona-p1")).toHaveTextContent("Mine");
    expect(screen.getByTestId("agent-persona-builtin:interviewer")).toBeDisabled();
    expect(screen.getByTestId("agent-persona-builtin:interviewer")).toHaveTextContent("Disabled");
    await userEvent.click(screen.getByTestId("agent-picker-tab-mine"));
    expect(screen.queryByTestId("agent-persona-builtin:coach")).toBeNull();
    expect(screen.getByTestId("agent-persona-p1")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-persona-none")).toBeNull();
  });

  it("selects a persona or no persona", async () => {
    const { onSelect } = setup();
    await userEvent.click(await screen.findByTestId("agent-persona-p1"));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1", name: "Quiz" }));
    await userEvent.click(screen.getByTestId("agent-persona-none"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("disables creating at the limit and shows the visibility note (D3)", async () => {
    setup({}, 1);
    const create = await screen.findByTestId("agent-persona-create");
    expect(create).toBeDisabled();
    expect(create).toHaveTextContent("Up to 1");
    expect(screen.getByText(/persona text if it is public/)).toBeInTheDocument();
  });

  it("opens the editor for my persona instead of a nested dialog", async () => {
    setup({ mode: "manage" });
    await userEvent.click(await screen.findByTestId("agent-persona-edit-p1"));
    const editor = await screen.findByTestId("agent-persona-editor");
    expect(within(editor).getByTestId("agent-editor-name")).toHaveValue("Quiz");
    expect(screen.queryByTestId("agent-persona-picker")).toBeNull();
  });
});
