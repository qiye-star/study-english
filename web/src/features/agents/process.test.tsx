import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { render as rtlRender } from "@testing-library/react";
import { TestProviders } from "~/test/render";
import { ProcessCapsule } from "./process-capsule";
import { SourceChips } from "./source-chips";
import { resetAgentsCaches } from "./use-agents-data";
import type { AgentStep, AgentTrace, LiveTrace } from "./types";

const step = (id: string, over: Partial<AgentStep> = {}): AgentStep =>
  ({ id, group: "tool", key: "word_lookup", status: "done", labelKey: "x", params: { word: "abandon" }, ms: 90, private: false, ...over });
const TRACE: AgentTrace = {
  v: 1, ms: 3400,
  steps: [step("c1", { group: "context", key: "persona", params: undefined }), step("t1"), step("t2", { key: "weak_words", status: "fail", params: undefined })],
  thought: { source: "summary", text: "Give a synonym first." },
};
const LIVE: LiveTrace = { turnId: "t", startedAt: Date.now(), steps: [step("t1", { status: "run" })], thought: null, meta: null, phase: "prep" };

function render(ui: React.ReactElement, settings: Record<string, unknown> | null = null) {
  const mock = createFetchMock({ "GET /api/agents/settings": () => (settings ? json(settings) : json({ error: "Not Found" }, 404)) });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  // wrapper (not renderWithProviders) so that rerender() keeps the providers
  return rtlRender(ui, { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
}

describe("ProcessCapsule (spec §5, D1)", () => {
  beforeEach(() => resetAgentsCaches());

  it("is expanded while generating and collapses into one line when done", async () => {
    const view = render(<ProcessCapsule live={LIVE} generating />);
    expect(screen.getByTestId("agent-process-card")).toHaveAttribute("data-state", "running");
    expect(screen.getByText("Preparing reply")).toBeInTheDocument();
    expect(screen.getByTestId("agent-tool-row")).toHaveTextContent("Look up · abandon");
    expect(screen.getByText("Running")).toBeInTheDocument();
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    const capsule = await screen.findByTestId("agent-capsule");
    expect(capsule).toHaveTextContent("Thought for 3s · used 1 tool");
    expect(capsule).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("agent-process-card")).toBeNull();
    await userEvent.click(capsule);
    expect(screen.getByTestId("agent-process-card")).toHaveAttribute("data-state", "done");
    await userEvent.click(screen.getByTestId("agent-process-collapse"));
    expect(screen.getByTestId("agent-capsule")).toBeInTheDocument();
  });

  it("labels the thought source and shows a failed tool as a red row with retry only when regenerating is possible", async () => {
    const onRegenerate = vi.fn();
    const view = render(<ProcessCapsule trace={TRACE} generating={false} onRegenerate={onRegenerate} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    expect(screen.getByTestId("agent-thought")).toHaveTextContent("Approach · the model's own summary, not raw reasoning");
    const failed = screen.getAllByTestId("agent-tool-row").find((r) => r.getAttribute("data-status") === "fail")!;
    expect(failed).toHaveTextContent("Your weak words failed");
    expect(failed).toHaveTextContent("The reply did not use this");
    await userEvent.click(screen.getByTestId("agent-tool-retry"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    expect(screen.queryByTestId("agent-tool-retry")).toBeNull();
  });

  it("shows a skipped source as neutral, not as a failure (R-W5)", async () => {
    render(<ProcessCapsule trace={{ ...TRACE, steps: [step("t3", { key: "due_words", status: "skip", params: undefined })] }} generating={false} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    expect(screen.getByTestId("agent-tool-row")).toHaveTextContent("Too slow, not used this time");
    expect(screen.queryByTestId("agent-tool-retry")).toBeNull();
  });

  it("opens the tool detail sheet with the word only and the privacy note", async () => {
    render(<ProcessCapsule trace={TRACE} generating={false} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    await userEvent.click(screen.getAllByTestId("agent-tool-row")[0]);
    const sheet = await screen.findByTestId("agent-step-sheet");
    expect(sheet).toHaveTextContent("word: abandon");
    expect(sheet).toHaveTextContent("90 ms");
    expect(sheet).toHaveTextContent("never your full conversation");
  });

  it("with show_process off: only 'Replying…' while generating, nothing afterwards (R-W14)", async () => {
    const off: Record<string, unknown> = { tools: {}, memory_enabled: true, share_in_rooms: true, show_process: false, default_persona_id: null, tutor: { length: 8, mix: ["ask"] } };
    const view = render(<ProcessCapsule live={LIVE} generating />, off);
    expect(await screen.findByTestId("agent-process-quiet")).toHaveTextContent("Replying…");
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    expect(screen.queryByTestId("agent-capsule")).toBeNull();
    expect(screen.queryByTestId("agent-process-quiet")).toBeNull();
  });

  it("shows a preparing pill before the first event and nothing for a finished turn without a trace", () => {
    const view = render(<ProcessCapsule live={null} generating />);
    expect(screen.getByTestId("agent-process-quiet")).toHaveTextContent("Preparing reply");
    view.rerender(<ProcessCapsule live={null} trace={null} generating={false} />);
    expect(screen.queryByTestId("agent-process-quiet")).toBeNull();
  });

  it("uses a caller label for the collapsed line (rooms)", async () => {
    render(<ProcessCapsule trace={TRACE} generating={false} showProcess label="Emma answered · for Lin" />);
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Emma answered · for Lin");
  });
});

describe("SourceChips", () => {
  beforeEach(() => resetAgentsCaches());

  it("renders one teal chip per successful tool and opens its details", async () => {
    render(<SourceChips trace={TRACE} />);
    const chips = await screen.findAllByTestId("agent-source");
    expect(chips.map((c) => c.textContent)).toEqual(["Dictionary · abandon"]);
    await userEvent.click(chips[0]);
    expect(await screen.findByTestId("agent-step-sheet")).toHaveTextContent("word: abandon");
  });
});
