import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClipSeg } from "./clip";
import type { DubbingTake } from "./dubbing-api";
import type { LineOutcome } from "./line-queue";
import { ResultsView } from "./results-view";

const segs = [
  { idx: 0, startMs: 0, endMs: 1000, speaker: "A", text: "Where are you going?" },
  { idx: 1, startMs: 1000, endMs: 2000, speaker: "B", text: "I am late." },
  { idx: 2, startMs: 2000, endMs: 3000, speaker: "A", text: "Then run." },
] as (ClipSeg & { text: string })[];

const take = (over: Partial<DubbingTake> = {}): DubbingTake => ({
  id: "d1", itemId: "i1", segFrom: 0, segTo: 2, role: "A", status: "done", expected: [0, 2],
  totalScore: 71, summary: { pronunciation: 80, fluency: 70, sync: null },
  lines: [
    { segIdx: 0, assessmentId: "a0", pronunciation: 90, fluency: 80, sync: 70, syncBasis: "words", score: 84, onsetMs: 10, ratioPct: 100, stale: false },
    { segIdx: 2, missing: true, reason: "not_recorded", stale: true },
  ],
  createdAt: "t", finishedAt: "t", ...over,
});

function player() {
  return { original: vi.fn(), mine: vi.fn(), stop: vi.fn() };
}

describe("results view (plan L5 W10)", () => {
  it("shows the total and the three sub-scores; a missing sub-score shows a dash", () => {
    render(<ResultsView take={take()} segs={segs} outcomes={[]} mineUrls={new Map()} player={player()} onRetry={() => {}} onExit={() => {}} />);
    expect(screen.getByTestId("total")).toHaveTextContent("71");
    expect(screen.getByText("Pronunciation 80")).toBeInTheDocument();
    expect(screen.getByText("Fluency 70")).toBeInTheDocument();
    expect(screen.getByText("Timing —")).toBeInTheDocument();
  });

  it("each scored sentence shows its score and how its timing was judged", () => {
    render(<ResultsView take={take()} segs={segs} outcomes={[]} mineUrls={new Map()} player={player()} onRetry={() => {}} onExit={() => {}} />);
    const row = screen.getByText("Where are you going?").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("84");
    expect(row).toHaveTextContent("By time");
  });

  it("a sentence the server marks as changed says so; a missing one says why", () => {
    render(<ResultsView take={take()} segs={segs} outcomes={[]} mineUrls={new Map()} player={player()} onRetry={() => {}} onExit={() => {}} />);
    const row = screen.getByText("Then run.").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("The sentence has changed");
    expect(row).toHaveTextContent("Not recorded");
  });

  it("a client-side reason (no speech) wins over the server's when we have it", () => {
    const outcomes: LineOutcome[] = [{ idx: 2, status: "missing", reason: "no_speech", messageKey: null }];
    render(<ResultsView take={take()} segs={segs} outcomes={outcomes} mineUrls={new Map()} player={player()} onRetry={() => {}} onExit={() => {}} />);
    expect(screen.getByText("Then run.").closest("li")).toHaveTextContent("No speech");
  });

  it("'Original' plays the sentence; 'Mine' plays the local take and is disabled when there is none", () => {
    const p = player();
    render(<ResultsView take={take()} segs={segs} outcomes={[]} mineUrls={new Map([[0, "blob:x"]])} player={p} onRetry={() => {}} onExit={() => {}} />);
    const row = screen.getByText("Where are you going?").closest("li") as HTMLElement;
    fireEvent.click(row.querySelector("[data-action='original']") as HTMLElement);
    expect(p.original).toHaveBeenCalledWith(0);
    fireEvent.click(row.querySelector("[data-action='mine']") as HTMLElement);
    expect(p.mine).toHaveBeenCalledWith("blob:x");
    const other = screen.getByText("Then run.").closest("li") as HTMLElement;
    expect(other.querySelector("[data-action='mine']")).toBeDisabled();
  });

  it("'Record again' and 'Change clip' hand control back", () => {
    const onRetry = vi.fn();
    const onExit = vi.fn();
    render(<ResultsView take={take()} segs={segs} outcomes={[]} mineUrls={new Map()} player={player()} onRetry={onRetry} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    fireEvent.click(screen.getByRole("button", { name: "Change clip" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
