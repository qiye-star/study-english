import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { RoomMessageList } from "../room-message-list";
import { initialRoomState, type RoomState } from "../room-state";
import { answer, ME, msg } from "./fixtures";

// Keep the real normalizeTrace / types; only the lazy capsule is replaced by a probe.
vi.mock("~/features/agents", async (importActual) => ({
  ...(await importActual<typeof import("~/features/agents")>()),
  ProcessCapsule: (p: { generating: boolean; live: { steps: unknown[] } | null; trace: { steps: unknown[] } | null; label?: string }) =>
    <div data-testid="capsule" data-generating={String(p.generating)} data-steps={p.live?.steps.length ?? 0}
      data-trace={p.trace ? "yes" : "no"} data-label={p.label ?? ""} />,
}));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const EMMA_META = { agent: { personaId: "builtin:coach", name: "Emma" } };
const question = (sender: number, name: string) => msg({ seq: 4, text: "@Emma can I use abandon?", sender: { kind: "user", id: sender, name }, aiStatus: "done" });
const step = { id: "s1", group: "context" as const, key: "learned_words", status: "done" as const, labelKey: "agents.step.learned_words", private: true };

function show(over: Partial<RoomState>, onOpenAgent = vi.fn()) {
  const state: RoomState = { ...initialRoomState(), status: "live", me: { userId: ME, role: "member" }, ...over };
  renderWithProviders(<RoomMessageList state={state} roomId="r1" reported={new Set()} autoText={false} onLoadEarlier={() => {}}
    onReport={() => {}} onReact={() => {}} onQuote={() => {}} onTranslateVoice={() => true} onRetryVoice={() => {}}
    agentNames={["Emma", "Leo"]} onOpenAgent={onOpenAgent} />);
  return onOpenAgent;
}

it("others see the agent tag and the answered-for line, never the process", () => {
  const onOpen = show({ messages: [question(22, "bob"), answer(5, 4, { ...EMMA_META, asker: { id: 22, name: "bob" } })],
    // even if a run/trace were somehow in state (it is not sent to them), another member never renders it
    agentTraces: { 5: { steps: [] } }, agentRuns: { 4: { turnId: "t1", steps: [step], thought: null, answerSeq: 5 } } });
  expect(screen.getByText("智能体")).toBeInTheDocument();
  expect(screen.getByTestId("room-agent-answered")).toHaveTextContent("Emma 已回答 · 对 bob");
  expect(screen.queryByTestId("capsule")).toBeNull();
  expect(screen.queryByText("仅你可见")).toBeNull();
  fireEvent.click(screen.getByTestId("room-agent-name"));
  expect(onOpen).toHaveBeenCalledWith("builtin:coach");
});

it("the asker sees a private capsule live under the question while the agent answers", () => {
  show({ messages: [{ ...question(ME, "alice"), aiStatus: "pending" }], aiTyping: [4],
    agentRuns: { 4: { turnId: "t1", steps: [step], thought: null, answerSeq: null } } });
  expect(screen.getByText("仅你可见")).toBeInTheDocument();
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-generating", "true");
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-steps", "1");
  expect(screen.getByRole("status")).toHaveTextContent("Emma 正在回答…");
});

it("after the answer the asker's capsule uses the trace and no answered-for line is shown", () => {
  show({ messages: [question(ME, "alice"), answer(5, 4, { ...EMMA_META, asker: { id: ME, name: "alice" } })],
    agentRuns: { 4: { turnId: "t1", steps: [step], thought: null, answerSeq: 5 } }, agentTraces: { 5: { steps: [] } } });
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-trace", "yes");
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-generating", "false");
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-label", "Emma 的思考过程");
  expect(screen.queryByTestId("room-agent-answered")).toBeNull();
});

it("a hand-off shows the hand-off line; plain @ai answers keep the old card", () => {
  const plain = { ...answer(7, 4, {}, "It means hello."), meta: null as Record<string, unknown> | null };
  show({ messages: [question(22, "bob"), answer(5, 4, { ...EMMA_META, asker: { id: 22, name: "bob" } }),
    answer(6, 5, { agent: { personaId: "u1", name: "Leo" }, asker: { id: 22, name: "bob" }, handoffFrom: EMMA_META.agent }, "The grammar is right."),
    plain] });
  expect(screen.getByTestId("room-agent-handoff")).toHaveTextContent("Emma → Leo");
  expect(screen.getByText("AI 助手")).toBeInTheDocument();
});
