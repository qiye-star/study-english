import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders, renderWithProviders } from "~/test/render";
import { PersonaEditorSheet } from "./persona-editor-sheet";
import { resetAgentsCaches } from "./use-agents-data";
import type { Persona } from "./types";

const CONFIG = {
  enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 },
};
const MINE: Persona = { id: "p1", builtin: false, mine: true, name: "Quiz", intro: "Friday quiz", prompt: "Ask five questions.", level: "B1", style: "strict",
  voice: null, tools: ["lookup"], promptPublic: false, deepThink: false, disabled: false, createdAt: null, updatedAt: null };

function setup(routes: Record<string, Handler>, persona: Persona | null = null) {
  const mock = createFetchMock({ "GET /api/agents/config": () => json(CONFIG), ...routes });
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  renderWithProviders(<PersonaEditorSheet open onOpenChange={() => undefined} persona={persona} onSaved={onSaved} onDeleted={onDeleted} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onSaved, onDeleted };
}
const bodyOf = (mock: ReturnType<typeof createFetchMock>, path: string) =>
  JSON.parse(String(mock.calls.find((c) => c.url.pathname === path && c.method !== "GET")!.body));

describe("PersonaEditorSheet (mockup 6, D2, D3)", () => {
  beforeEach(() => { resetAgentsCaches(); resetServerAiConfigCache(); });

  it("starts a new persona with every tool on and the persona text public, counts characters and saves snake_case", async () => {
    const { mock, onSaved } = setup({ "POST /api/agents/personas": () => json({ ...MINE, id: "p9", prompt_public: true }) });
    for (const key of ["lookup", "learned_words", "weak_words", "due_words", "memory"]) {
      expect(screen.getByTestId(`agent-editor-tool-${key}`)).toHaveAttribute("data-state", "checked");
    }
    expect(screen.getByTestId("agent-editor-prompt-public")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("agent-editor-save")).toBeDisabled();
    await userEvent.type(screen.getByTestId("agent-editor-name"), "  Quiz ");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask five questions.");
    expect(await screen.findByTestId("agent-editor-prompt-count")).toHaveTextContent("19 / 800");
    await userEvent.click(screen.getByTestId("agent-editor-style-strict"));
    await userEvent.click(screen.getByTestId("agent-editor-tool-memory"));
    await userEvent.click(screen.getByTestId("agent-editor-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodyOf(mock, "/api/agents/personas")).toEqual({
      name: "Quiz", intro: "", prompt: "Ask five questions.", level: "B1", style: "strict", voice: null,
      tools: ["lookup", "learned_words", "weak_words", "due_words"], prompt_public: true, deep_think: false,
    });
  });

  it("labels the level chips and explains the chosen level (plan 2026-10-14-level-annotations W10)", async () => {
    setup({}, MINE);
    expect(await screen.findByTestId("agent-editor-level-B1")).toHaveTextContent("B1 · Intermediate");
    expect(screen.getByTestId("agent-editor-level-hint")).toHaveTextContent("Copes with most everyday situations");
    await userEvent.click(screen.getByTestId("agent-editor-level-B2"));
    expect(screen.getByTestId("agent-editor-level-B2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("agent-editor-level-hint")).toHaveTextContent("Talks fluently about familiar topics");
  });

  it("tries a line without saving and shows the reply; a 404 hides trying for good", async () => {
    let available = true;
    const { mock } = setup({ "POST /api/agents/personas/try": () => (available ? json({ text: "Hello, I am Quiz." }) : json({ error: "Not Found" }, 404)) });
    await userEvent.type(screen.getByTestId("agent-editor-name"), "Quiz");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask five questions.");
    await userEvent.click(screen.getByTestId("agent-editor-try"));
    expect(await screen.findByTestId("agent-editor-try-reply")).toHaveTextContent("Hello, I am Quiz.");
    expect(bodyOf(mock, "/api/agents/personas/try")).toMatchObject({ text: "Hi! Can you introduce yourself?", persona: { name: "Quiz" } });
    expect(mock.calls.some((c) => c.url.pathname === "/api/agents/personas" && c.method === "POST")).toBe(false);
    available = false;
    await userEvent.click(screen.getByTestId("agent-editor-try"));
    expect(await screen.findByText("Trying is not available right now.")).toBeInTheDocument();
    expect(screen.getByTestId("agent-editor-try")).toBeDisabled();
  });

  it("edits an existing persona and deletes it only after a second tap", async () => {
    const { mock, onDeleted } = setup({ "DELETE /api/agents/personas/p1": () => json({ id: "p1" }) }, MINE);
    expect(screen.getByTestId("agent-editor-name")).toHaveValue("Quiz");
    expect(screen.getByTestId("agent-editor-tool-memory")).toHaveAttribute("data-state", "unchecked");
    await userEvent.click(screen.getByTestId("agent-editor-delete"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByTestId("agent-editor-delete")).toHaveTextContent("Tap again to delete");
    await userEvent.click(screen.getByTestId("agent-editor-delete"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("p1"));
  });

  it("keeps the draft when the personas list revalidates and hands a new object for the same persona", async () => {
    const mock = createFetchMock({ "GET /api/agents/config": () => json(CONFIG) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const view = rtlRender(<PersonaEditorSheet open onOpenChange={() => undefined} persona={MINE} onSaved={vi.fn()} onDeleted={vi.fn()} />,
      { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
    const name = screen.getByTestId("agent-editor-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Edited");
    view.rerender(<PersonaEditorSheet open onOpenChange={() => undefined} persona={{ ...MINE }} onSaved={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByTestId("agent-editor-name")).toHaveValue("Edited");
    view.rerender(<PersonaEditorSheet open onOpenChange={() => undefined} persona={{ ...MINE, id: "p2", name: "Other" }} onSaved={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByTestId("agent-editor-name")).toHaveValue("Other");
  });

  it("shows the limit message on 429/409 and keeps the sheet open", async () => {
    const { onSaved } = setup({ "POST /api/agents/personas": () => json({ error: "Persona limit reached" }, 429) });
    await userEvent.type(screen.getByTestId("agent-editor-name"), "Quiz");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask.");
    await userEvent.click(screen.getByTestId("agent-editor-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have reached the persona limit.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
