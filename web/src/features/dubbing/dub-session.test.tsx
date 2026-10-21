import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TakeResult } from "./take-runner";
import { DubSession, type DubSessionProps } from "./dub-session";

const h = vi.hoisted(() => {
  const video = { currentTime: 0, paused: true } as unknown as HTMLVideoElement;
  const dub = { state: "idle" as string, result: null as unknown, outcomes: [] as unknown[], start: vi.fn(), stop: vi.fn() };
  const sched = { start: vi.fn(), destroy: vi.fn() };
  return { video, dub, sched, createTakeScheduler: vi.fn(() => sched) };
});

// The stage is covered by its own test; here it only hands its video element to the session.
vi.mock("./stage", async () => {
  const React = await import("react");
  return {
    DubStage: ({ onElement, subtitle }: { onElement: (el: HTMLVideoElement) => void; subtitle: unknown }) => {
      React.useEffect(() => { onElement(h.video); }, [onElement]);
      return React.createElement("div", { "data-testid": "stage" }, subtitle as never);
    },
  };
});
vi.mock("./use-dub-take", () => ({ useDubTake: () => h.dub }));
vi.mock("./take-scheduler", async (orig) => ({
  ...(await orig<typeof import("./take-scheduler")>()),
  createTakeScheduler: h.createTakeScheduler,
  createTakeFrames: () => ({ request: () => 0, cancel: () => {} }),
}));

const SEGS = [
  { idx: 0, startMs: 0, endMs: 1000, speaker: "A" as const, text: "Where are you going?" },
  { idx: 1, startMs: 1000, endMs: 2000, speaker: "B" as const, text: "Home." },
  { idx: 2, startMs: 2000, endMs: 3000, speaker: "A" as const, text: "I am late for my flight." },
];
const RESULT = { take: { id: "take-1" }, outcomes: [], urls: new Map() } as unknown as TakeResult;

function props(over: Partial<DubSessionProps> = {}): DubSessionProps {
  return {
    itemId: "11111111-1111-4111-8111-111111111111", segs: SEGS, from: 0, to: 2, role: "A", roleName: "Host",
    beforeMs: 300, afterMs: 600, onExit: vi.fn(), onDone: vi.fn(), ...over,
  };
}

afterEach(cleanup);

describe("DubSession (plan L5 W9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.dub.state = "idle";
    h.dub.result = null;
    h.dub.outcomes = [];
  });

  it("opens on the rehearsal view with the role and every line of the clip", () => {
    render(<DubSession {...props()} />);
    expect(screen.getByText("You are Host")).toBeInTheDocument();
    expect(screen.getByText("Where are you going?")).toBeInTheDocument();
    expect(screen.getByText("I am late for my flight.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("rehearse plays the clip through the scheduler and never opens the microphone", async () => {
    render(<DubSession {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rehearse" }));
    await waitFor(() => expect(h.sched.start).toHaveBeenCalledTimes(1));
    expect(h.createTakeScheduler).toHaveBeenCalledWith(expect.objectContaining({
      media: h.video, clipStartMs: 0, clipEndMs: 3000, windows: [],
    }));
    expect(h.dub.start).not.toHaveBeenCalled();
  });

  it("start recording hands the take to the hook in the same tap and switches to the recording view", () => {
    render(<DubSession {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(h.dub.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rehearse" })).toBeNull();
  });

  it("stopping and discarding stops the take and returns to the rehearsal", () => {
    render(<DubSession {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and discard" }));
    expect(h.dub.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Rehearse" })).toBeInTheDocument();
  });

  it("back leaves the session", () => {
    const onExit = vi.fn();
    render(<DubSession {...props({ onExit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("passes a finished take to onDone exactly once", () => {
    h.dub.state = "done";
    h.dub.result = RESULT;
    const onDone = vi.fn();
    const { rerender } = render(<DubSession {...props({ onDone })} />);
    rerender(<DubSession {...props({ onDone })} />);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(RESULT);
  });

  it("explains an interrupted take (the app went to the background)", () => {
    h.dub.state = "interrupted";
    render(<DubSession {...props()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Recording stopped");
  });

  it("shows a generic alert when the take fails", () => {
    h.dub.state = "error";
    render(<DubSession {...props()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
