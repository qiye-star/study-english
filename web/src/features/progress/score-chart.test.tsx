import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreChart, chartSegments } from "./score-chart";
import type { StatsDay } from "./stats-api";

const day = (avg: number | null): StatsDay => ({ date: "d", active: avg !== null, userMessages: 0, assessments: 0, speakingSeconds: 0, avgPronunciation: avg });

describe("score chart", () => {
  it("splits the line at days without a score and maps 0–100 to the height", () => {
    const segs = chartSegments([day(100), day(50), day(null), day(0)], 100, 100, 0);
    expect(segs).toEqual([[{ x: 0, y: 0 }, { x: 100 / 3, y: 50 }], [{ x: 100, y: 100 }]]);
    expect(chartSegments([day(80)], 100, 100, 10)).toEqual([[{ x: 50, y: 26 }]]);
    expect(chartSegments([day(null), day(null)], 100, 100, 0)).toEqual([]);
    expect(chartSegments([day(150), day(-5)], 100, 100, 0)).toEqual([[{ x: 0, y: 0 }, { x: 100, y: 100 }]]);
  });
  it("renders an accessible inline SVG", () => {
    render(<ScoreChart daily={[day(70), day(null), day(90)]} label="Daily pronunciation" />);
    const svg = screen.getByTestId("progress-chart");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("data-points", "2");
    expect(svg).toHaveAttribute("aria-label", "Daily pronunciation");
  });
  it("carries a title and a description for assistive technology", () => {
    render(<ScoreChart daily={[day(70)]} label="Daily pronunciation" description="1 day with a score" />);
    const svg = screen.getByTestId("progress-chart");
    expect(svg.querySelector("title")).toHaveTextContent("Daily pronunciation");
    const desc = svg.querySelector("desc")!;
    expect(desc).toHaveTextContent("1 day with a score");
    expect(svg).toHaveAttribute("aria-describedby", desc.id);
  });
});
