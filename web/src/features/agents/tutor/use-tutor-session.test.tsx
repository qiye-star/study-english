import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import "./locales";
import { RAW_RECAP, SID, rawSession } from "./tutor-fixtures";
import { useTutorSession } from "./use-tutor-session";

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock({ [`GET /api/agents/tutor/${SID}`]: () => json(rawSession()), ...routes });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onContinue = vi.fn();
  const onError = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const hook = renderHook(({ meta }: { meta: unknown }) => useTutorSession({ api, sessionId: SID, meta, onContinue, onError }),
    { wrapper, initialProps: { meta: null as unknown } });
  return { ...hook, mock, onContinue, onError };
}

const metaEvent = (over: Record<string, unknown>) => ({ stepIndex: 3, stepsTotal: 5, verdict: "good", kind: "repeat", done: false, ...over });

it("loads the session on mount", async () => {
  const { result } = setup({});
  await waitFor(() => expect(result.current.session?.stepIndex).toBe(2));
});

it("meta events advance the lesson and a done meta finishes it once", async () => {
  const { result, rerender, mock } = setup({
    [`POST /api/agents/tutor/${SID}/finish`]: () => json(rawSession({ status: "done", phase: "done", recap: RAW_RECAP })),
  });
  await waitFor(() => expect(result.current.session?.stepIndex).toBe(2));
  rerender({ meta: metaEvent({}) });
  expect(result.current.session?.stepIndex).toBe(3);
  expect(result.current.session?.kind).toBe("repeat");
  rerender({ meta: metaEvent({ stepIndex: 5, verdict: "ok", kind: undefined, done: true }) });
  await waitFor(() => expect(result.current.session?.status).toBe("done"));
  expect(mock.calls.filter((c) => c.url.pathname.endsWith("/finish"))).toHaveLength(1);
  expect(result.current.session?.recap?.words).toEqual(["abandon", "resilient"]);
});

it("hint shows the server text; skip lets the agent ask the next question", async () => {
  const { result, onContinue } = setup({
    [`POST /api/agents/tutor/${SID}/hint`]: () => json({ hint: "想想昨天", session: rawSession({ hints_used: 1 }) }),
    [`POST /api/agents/tutor/${SID}/skip`]: () => json(rawSession({ phase: "ask", step_index: 3 })),
  });
  await waitFor(() => expect(result.current.session).not.toBeNull());
  await act(async () => { await result.current.requestHint(); });
  expect([result.current.hint, result.current.session?.hintsUsed]).toEqual(["想想昨天", 1]);
  await act(async () => { await result.current.skip(); });
  expect(result.current.hint).toBeNull();
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it("a session waiting for the agent only asks when resumed", async () => {
  const { result, onContinue } = setup({
    [`GET /api/agents/tutor/${SID}`]: () => json(rawSession({ phase: "ask", step_index: 3 })),
  });
  await waitFor(() => expect(result.current.session?.phase).toBe("ask"));
  expect(onContinue).not.toHaveBeenCalled();
  act(() => result.current.resume());
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it("server errors become translated messages", async () => {
  const { result, onError } = setup({
    [`POST /api/agents/tutor/${SID}/hint`]: () => json({ error: "Hint limit reached" }, 409),
  });
  await waitFor(() => expect(result.current.session).not.toBeNull());
  await act(async () => { await result.current.requestHint(); });
  expect(onError).toHaveBeenCalledWith("No more hints for this question");
  expect(result.current.hint).toBeNull();
});
