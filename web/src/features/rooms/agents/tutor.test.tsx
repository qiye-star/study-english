import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO, ME, TUTOR } from "./fixtures";
import { TutorBar } from "./tutor-bar";
import { TUTOR_STEPS, TutorStart } from "./tutor-start";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const ok = () => json({ ok: true });
function api(routes = {}) {
  const mock = createFetchMock({ "POST /api/rooms/r1/agents/tutor/skip": ok, "POST /api/rooms/r1/agents/tutor/stop": ok,
    "POST /api/rooms/r1/agents/tutor/resume": () => json({ tutor: null }), ...routes });
  return { mock, client: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

it("tells the called member it is their turn and counts down", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  renderWithProviders(<TutorBar tutor={TUTOR} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("轮到你了");
  expect(screen.getByText("第 2/8 题")).toBeInTheDocument();
  expect(screen.getByText("剩余 42 秒")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByText("剩余 40 秒")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "跳过" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "结束带练" })).toBeNull();
  // reduced motion: the ring and the pulse only animate under motion-safe
  expect(screen.getByTestId("room-tutor-ring").getAttribute("class")).toContain("motion-safe:transition-[stroke-dashoffset]");
  expect(screen.getByTestId("room-tutor-bar").innerHTML).not.toMatch(/(^|[\s"])animate-pulse/);
});

it("others see whose turn it is and the owner may skip them", async () => {
  const { mock, client } = api();
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, currentUserId: 22, currentName: "bob" }} receivedAt={Date.now()}
    meId={ME} isOwner roomId="r1" disabled={false} />, { api: client });
  expect(screen.getByRole("status")).toHaveTextContent("轮到 bob");
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/skip"));
});

it("a paused round shows why; the owner resumes or ends it", async () => {
  const { mock, client } = api();
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, phase: "paused", pausedReason: "restart", remainingMs: null }} receivedAt={0}
    meId={ME} isOwner roomId="r1" disabled={false} />, { api: client });
  expect(screen.getByRole("status")).toHaveTextContent("服务重启,带练已暂停");
  expect(screen.queryByTestId("room-tutor-countdown")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/resume"));
  fireEvent.click(screen.getByRole("button", { name: "结束带练" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/stop"));
});

it("renders nothing without a tutor", () => {
  const { container } = renderWithProviders(<TutorBar tutor={null} receivedAt={0} meId={ME} isOwner roomId="r1" disabled={false} />);
  expect(container.querySelector("[data-testid=room-tutor-bar]")).toBeNull();
});

it("the step range matches the server (tutor_rotation re-exports agents/tutor/plan LENGTH_*)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = path.resolve(here, "../../../../../server/app");
  expect(readFileSync(path.join(server, "agents/tutor/plan.py"), "utf8"))
    .toContain(`LENGTH_MIN, LENGTH_MAX, LENGTH_DEFAULT = ${TUTOR_STEPS.min}, ${TUTOR_STEPS.max}, ${TUTOR_STEPS.initial}`);
  const rotation = readFileSync(path.join(server, "rooms/tutor_rotation.py"), "utf8");
  expect(rotation).toContain("LENGTH_DEFAULT as DEFAULT_STEPS");
  expect(rotation).toContain("LENGTH_MAX as MAX_STEPS");
  expect(rotation).toContain("LENGTH_MIN as MIN_STEPS");
  expect(readFileSync(path.join(server, "routers/rooms_agents.py"), "utf8")).toContain(`ge=${TUTOR_STEPS.min}, le=${TUTOR_STEPS.max}`);
});

it("a paused reason the web has no copy for (or a future one) still shows a message", () => {
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, phase: "paused", pausedReason: "state", remainingMs: null }} receivedAt={0}
    meId={ME} isOwner roomId="r1" disabled={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("带练状态异常");
  cleanup();
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, phase: "paused", pausedReason: "from_the_future" as never, remainingMs: null }} receivedAt={0}
    meId={ME} isOwner roomId="r1" disabled={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("AI 暂时不可用");
});

it("the owner starts a round with a persona and a question count within the range", async () => {
  const { mock, client } = api({ "POST /api/rooms/r1/agents/tutor/start": () => json({ tutor: null }) });
  const onStarted = vi.fn();
  renderWithProviders(<TutorStart roomId="r1" agents={[EMMA, LEO]} onStarted={onStarted} />, { api: client });
  fireEvent.click(screen.getByRole("radio", { name: "Leo" }));
  fireEvent.click(screen.getByRole("button", { name: "少一题" }));
  expect(screen.getByTestId("room-tutor-steps")).toHaveTextContent("7 题");
  fireEvent.click(screen.getByRole("button", { name: "开始带练" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ persona_id: "u1", steps: 7 });
});
