import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CID, SID, rawSession } from "./tutor-fixtures";
import { TutorStartSheet, TutorStartSheetView } from "./tutor-start-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

it("defaults to free, 8 questions and typing", () => {
  const onStart = vi.fn();
  renderWithProviders(<TutorStartSheetView open onOpenChange={() => {}} busy={false} onStart={onStart} />);
  expect(screen.getByTestId("tutor-start-sheet")).toHaveTextContent("老师提问,你来回答");
  expect(screen.getByTestId("tutor-topic-free")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("tutor-start"));
  expect(onStart).toHaveBeenCalledWith({ topic: "free", scenario: null, length: 8, input: "text" });
});

it("picks a situation, 12 questions and voice", () => {
  const onStart = vi.fn();
  renderWithProviders(<TutorStartSheetView open onOpenChange={() => {}} busy={false} onStart={onStart} />);
  expect(screen.queryByTestId("tutor-scenario-travel")).toBeNull();
  fireEvent.click(screen.getByTestId("tutor-topic-scenario"));
  fireEvent.click(screen.getByTestId("tutor-scenario-travel"));
  fireEvent.click(screen.getByTestId("tutor-length-12"));
  fireEvent.click(screen.getByTestId("tutor-input-voice"));
  expect(screen.getByTestId("tutor-length-12")).toHaveTextContent("12 题");
  fireEvent.click(screen.getByTestId("tutor-start"));
  expect(onStart).toHaveBeenCalledWith({ topic: "scenario", scenario: "travel", length: 12, input: "voice" });
});

it("busy disables start", () => {
  renderWithProviders(<TutorStartSheetView open onOpenChange={() => {}} busy onStart={vi.fn()} />);
  expect(screen.getByTestId("tutor-start")).toBeDisabled();
});

function renderSlot(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  const onStarted = vi.fn();
  renderWithProviders(
    <TutorStartSheet open onOpenChange={() => {}} personaId="builtin:coach" conversationId={CID} onStarted={onStarted} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
  );
  return { mock, onStarted };
}

it("the slot starts a lesson and hands over the session id (agent speaks first, voice input)", async () => {
  const { mock, onStarted } = renderSlot({
    "POST /api/agents/tutor/start": () => json(rawSession({ phase: "opening", step_index: 1, answers: [], goal: { ...rawSession().goal as object, input: "voice" } })),
  });
  fireEvent.click(screen.getByTestId("tutor-input-voice"));
  fireEvent.click(screen.getByTestId("tutor-start"));
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith(SID, { input: "voice", speakFirst: true }));
  const body = JSON.parse(String(mock.calls.find((c) => c.method === "POST")!.body));
  expect(body).toMatchObject({ conversation_id: CID, persona_id: "builtin:coach", topic: "free", scenario: null, length: 8, input: "voice" });
  expect(body.client_start_id).toMatch(/^[0-9a-f-]{36}$/);
});

it("a resumed lesson that waits for the answer does not ask the agent to speak", async () => {
  const { onStarted } = renderSlot({ "POST /api/agents/tutor/start": () => json(rawSession({ resumed: true })) });
  fireEvent.click(screen.getByTestId("tutor-start"));
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith(SID, { input: "text", speakFirst: false }));
});

it("a server error becomes a translated toast and nothing starts", async () => {
  const { onStarted } = renderSlot({ "POST /api/agents/tutor/start": () => json({ error: "Daily tutor limit reached" }, 429) });
  fireEvent.click(screen.getByTestId("tutor-start"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("今天的带学次数用完了"));
  expect(onStarted).not.toHaveBeenCalled();
  expect(screen.getByTestId("tutor-start")).toBeEnabled();
});
