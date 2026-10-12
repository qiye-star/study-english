import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { TutorBarPanel, type TutorBarPanelProps } from "./tutor-bar-panel";
import { RAW_RECAP, SID, rawSession } from "./tutor-fixtures";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function renderPanel(routes: Record<string, Handler>, over: Partial<TutorBarPanelProps> = {}) {
  const mock = createFetchMock({ [`GET /api/agents/tutor/${SID}`]: () => json(rawSession()), ...routes });
  const props: TutorBarPanelProps = {
    sessionId: SID, meta: null, busy: false, onContinue: vi.fn(), onEnd: vi.fn(),
    lastReply: "What did you do yesterday?", onSpeak: vi.fn(), onTranslateLast: vi.fn(), ...over,
  };
  let setMeta: (m: unknown) => void = () => {};
  function Harness() {
    const [meta, set] = useState<unknown>(props.meta);
    setMeta = set;
    return <TutorBarPanel {...props} meta={meta} />;
  }
  renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { props, mock, sendMeta: (m: unknown) => act(() => setMeta(m)) };
}

it("shows the bar for the loaded lesson and follows meta events", async () => {
  const { sendMeta } = renderPanel({});
  expect(await screen.findByTestId("tutor-progress")).toHaveTextContent("第 2 / 5 题");
  sendMeta({ stepIndex: 3, stepsTotal: 5, verdict: "good", kind: "repeat", done: false });
  await waitFor(() => expect(screen.getByTestId("tutor-progress")).toHaveTextContent("第 3 / 5 题"));
});

it("listen speaks the dictation sentence for dictation questions; translate calls back", async () => {
  const { props } = renderPanel({ [`GET /api/agents/tutor/${SID}`]: () => json(rawSession({ kind: "dictate", say: "I left early." })) });
  fireEvent.click(await screen.findByTestId("tutor-listen"));
  expect(props.onSpeak).toHaveBeenCalledWith("I left early.");
  fireEvent.click(screen.getByTestId("tutor-translate"));
  expect(props.onTranslateLast).toHaveBeenCalledTimes(1);
});

it("listen reads the last reply for other question kinds", async () => {
  const { props } = renderPanel({});
  fireEvent.click(await screen.findByTestId("tutor-listen"));
  expect(props.onSpeak).toHaveBeenCalledWith("What did you do yesterday?");
});

it("keeps hint_zh out of 听一遍: listen speaks the last reply only", async () => {
  const { props } = renderPanel({
    [`POST /api/agents/tutor/${SID}/hint`]: () => json({ hint: "Talk about Saturday.", hint_zh: "说说周末", session: rawSession({ hints_used: 1 }) }),
  });
  fireEvent.click(await screen.findByTestId("tutor-hint-btn"));
  expect(await screen.findByTestId("tutor-hint-zh")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("tutor-listen"));
  expect(props.onSpeak).toHaveBeenCalledWith("What did you do yesterday?");
  expect(JSON.stringify((props.onSpeak as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("周末");
});

it("skip asks the agent for the next question through onContinue", async () => {
  const { props } = renderPanel({ [`POST /api/agents/tutor/${SID}/skip`]: () => json(rawSession({ phase: "ask", step_index: 3 })) });
  fireEvent.click(await screen.findByTestId("tutor-skip"));
  await waitFor(() => expect(props.onContinue).toHaveBeenCalledTimes(1));
});

it("ending opens the recap sheet with words to save; closing it leaves tutor mode", async () => {
  const { props } = renderPanel({
    [`POST /api/agents/tutor/${SID}/finish`]: () => json(rawSession({ status: "done", phase: "done", recap: RAW_RECAP })),
  });
  fireEvent.click(await screen.findByTestId("tutor-end"));
  fireEvent.click(screen.getByTestId("tutor-end"));
  expect(await screen.findByTestId("tutor-recap-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("tutor-word-abandon")).toBeInTheDocument();
  expect(props.onEnd).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByTestId("tutor-recap-sheet"), { key: "Escape" });
  await waitFor(() => expect(props.onEnd).toHaveBeenCalledTimes(1));
});

it("an expired lesson leaves tutor mode", async () => {
  const { props } = renderPanel({ [`GET /api/agents/tutor/${SID}`]: () => json(rawSession({ status: "expired" })) });
  await waitFor(() => expect(props.onEnd).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("tutor-bar")).toBeNull();
});
