import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { TutorBarSlot, TutorEntry } from "../chat-parts";
import { resetAgentsCaches } from "../use-agents-data";
import { CID, SID, rawSession } from "./tutor-fixtures";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const CONFIG = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 } };

it("the real slots are filled: the entry opens the start sheet and a start reports the session", async () => {
  resetAgentsCaches();
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(CONFIG),
    "POST /api/agents/tutor/start": () => json(rawSession({ phase: "opening", step_index: 1, answers: [] })),
  });
  const onStarted = vi.fn();
  renderWithProviders(<TutorEntry personaId="builtin:coach" conversationId={CID} disabled={false} onStarted={onStarted} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  fireEvent.click(await screen.findByTestId("agent-tutor-entry"));
  fireEvent.click(await screen.findByTestId("tutor-start"));
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith(SID, { input: "text", speakFirst: true }));
});

it("the real Bar slot loads the lesson and shows its progress", async () => {
  const mock = createFetchMock({ [`GET /api/agents/tutor/${SID}`]: () => json(rawSession()) });
  renderWithProviders(
    <TutorBarSlot sessionId={SID} meta={null} busy={false} onContinue={vi.fn()} onEnd={vi.fn()} lastReply="" onSpeak={vi.fn()} onTranslateLast={vi.fn()} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
  );
  expect(await screen.findByTestId("tutor-bar")).toBeInTheDocument();
});
