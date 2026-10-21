import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DubbingTake } from "./dubbing-api";
import { reopenedResult, TakeHistory } from "./take-history";

const take = (over: Partial<DubbingTake>): DubbingTake => ({
  id: "22222222-2222-4222-8222-222222222222", itemId: "11111111-1111-4111-8111-111111111111", segFrom: 2, segTo: 4,
  role: "B", status: "done", expected: [2, 4], totalScore: 81.6, summary: null, lines: [],
  createdAt: "2026-10-21T08:00:00Z", finishedAt: "2026-10-21T08:03:00Z", ...over,
});

describe("take history (plan L5 W10, reopen)", () => {
  it("shows nothing when there are no earlier takes", () => {
    const { container } = render(<TakeHistory takes={[]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists finished takes with their score and opens the one that was tapped", () => {
    const onOpen = vi.fn();
    const row = take({});
    render(<TakeHistory takes={[row]} onOpen={onOpen} />);
    expect(screen.getByText("Earlier takes")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Score 82")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith(row);
  });

  it("marks an unfinished take without offering to open it", () => {
    const onOpen = vi.fn();
    render(<TakeHistory takes={[take({ status: "recording", totalScore: null })]} onOpen={onOpen} />);
    expect(screen.getByText("Not finished")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("reopens a take from the server record alone: scores come from the take, and no local recording is claimed", () => {
    const row = take({});
    const result = reopenedResult(row);
    expect(result.take).toBe(row);
    expect(result.outcomes).toEqual([]);
    expect(result.urls.size).toBe(0);
  });
});
