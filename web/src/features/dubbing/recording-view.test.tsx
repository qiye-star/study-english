import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LineOutcome } from "./line-queue";
import { RecordingView } from "./recording-view";

const base = { expected: [0, 2], outcomes: [] as LineOutcome[], onAbandon: () => {} };

describe("recording view (plan L5 W9)", () => {
  it("shows the countdown and 'Your turn' while the user's sentence is open", () => {
    render(<RecordingView {...base} countdown={3} yourTurn />);
    expect(screen.getByTestId("countdown")).toHaveTextContent("3");
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("shows a waiting state when the other side is speaking", () => {
    render(<RecordingView {...base} countdown={null} yourTurn={false} />);
    expect(screen.queryByTestId("countdown")).toBeNull();
    expect(screen.getByText("Listen for your cue")).toBeInTheDocument();
  });

  it("one dot per expected sentence, showing where its score is", () => {
    const outcomes: LineOutcome[] = [
      { idx: 0, status: "scored", line: { segIdx: 0, pronunciation: 90, fluency: 80, sync: 70, syncBasis: "words", score: 84 } },
    ];
    render(<RecordingView {...base} outcomes={outcomes} countdown={null} yourTurn={false} />);
    expect(screen.getByLabelText("Sentence 1: Scored")).toBeInTheDocument();
    expect(screen.getByLabelText("Sentence 3: Queued")).toBeInTheDocument();
  });

  it("stop asks first; 'Keep recording' goes back, 'Stop and discard' abandons the run", () => {
    const onAbandon = vi.fn();
    render(<RecordingView {...base} onAbandon={onAbandon} countdown={null} yourTurn={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("Stop this take?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByText("Stop this take?")).toBeNull();
    expect(onAbandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop and discard" }));
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });
});
