import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClipPicker, clipReadiness, type PickSeg } from "./clip-picker";

const LIMITS = { maxLines: 12, maxMs: 90_000 };
const segs = (n: number, lenMs = 5000): PickSeg[] =>
  Array.from({ length: n }, (_, i) => ({
    idx: i, startMs: i * lenMs, endMs: (i + 1) * lenMs, speaker: i % 2 === 0 ? "A" : "B", text: `line ${i}`,
  })) as PickSeg[];

describe("clip picker (plan L5 W8)", () => {
  it("first tap starts, second tap ends, and a third tap starts over", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ClipPicker segments={segs(4)} selection={null} role="A" limits={LIMITS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /line 1/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ from: 1, to: null });
    rerender(<ClipPicker segments={segs(4)} selection={{ from: 1, to: null }} role="A" limits={LIMITS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /line 3/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ from: 1, to: 3 });
    rerender(<ClipPicker segments={segs(4)} selection={{ from: 1, to: 3 }} role="A" limits={LIMITS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /line 0/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ from: 0, to: null });
  });

  it("the footer counts sentences and seconds for a finished range", () => {
    render(<ClipPicker segments={segs(4)} selection={{ from: 0, to: 2 }} role="A" limits={LIMITS} onSelect={() => {}} />);
    expect(screen.getByText("3 sentences · 15 s")).toBeInTheDocument();
  });

  it("readiness reports the server's own codes (too long, role missing) and is ok otherwise", () => {
    const long = segs(13, 1000);
    expect(clipReadiness(long, { from: 0, to: 12 }, "A", LIMITS).problem).toBe("clip_too_long");
    expect(clipReadiness(segs(4), { from: 1, to: 1 }, "A", LIMITS).problem).toBe("role_missing");
    expect(clipReadiness(segs(4), { from: 0, to: 1 }, "A", LIMITS)).toMatchObject({ ok: true, problem: null });
    expect(clipReadiness(segs(4), { from: 0, to: 0 }, "A", LIMITS).ok).toBe(true);
    expect(clipReadiness(segs(4), null, "A", LIMITS).ok).toBe(false);
  });

  it("an over-long clip shows the reason on screen", () => {
    render(<ClipPicker segments={segs(13, 1000)} selection={{ from: 0, to: 12 }} role="A" limits={LIMITS} onSelect={() => {}} />);
    expect(screen.getByText("This clip is too long. Pick fewer sentences.")).toBeInTheDocument();
  });

  it("renders a marker slot next to each sentence", () => {
    render(<ClipPicker segments={segs(2)} selection={null} role="A" limits={LIMITS} onSelect={() => {}} renderMarker={(i) => <span>mark {i}</span>} />);
    expect(screen.getByText("mark 1")).toBeInTheDocument();
  });

  it("shows the cover above the sentences when there is one, and nothing when there is not", () => {
    const { container, rerender } = render(
      <ClipPicker segments={segs(2)} selection={null} role="A" limits={LIMITS} onSelect={() => {}} poster="blob:cover-1" />,
    );
    const cover = container.querySelector("img");
    expect(cover).toHaveAttribute("src", "blob:cover-1");
    expect(cover).toHaveAttribute("alt", "");
    expect(cover?.compareDocumentPosition(screen.getByRole("button", { name: /line 0/ }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    rerender(<ClipPicker segments={segs(2)} selection={null} role="A" limits={LIMITS} onSelect={() => {}} poster={null} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
