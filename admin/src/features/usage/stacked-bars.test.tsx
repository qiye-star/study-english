import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { shade, StackedBars } from "./stacked-bars";

const labels = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const series = [
  { name: "对话", values: [5, 6, 7, 8, 9, 10, 11] },
  { name: "语音", values: [1, 1, 1, 1, 1, 1, 1] },
  { name: "联机", values: [0, 2, 0, 2, 0, 2, 0] },
];

it("renders one titled rect per feature and day, and a data table view", async () => {
  const { container } = render(<StackedBars title="按日调用" labels={labels} series={series} />);
  const rects = container.querySelectorAll("rect");
  expect(rects).toHaveLength(21);
  rects.forEach((r) => expect(r.querySelector("title")?.textContent).toMatch(/:\d+$/));
  expect(container.querySelector("rect title")?.textContent).toBe("2026-10-03 · 对话:5");
  await userEvent.click(screen.getByRole("button", { name: "查看数据表" }));
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(8);
  expect(container.querySelectorAll("rect")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "查看图表" }));
  expect(container.querySelectorAll("rect")).toHaveLength(21);
});

it("shades one hue from dark to light", () => {
  expect(shade(0, 3)).toBe(1);
  expect(shade(2, 3)).toBeCloseTo(0.3);
  expect(shade(0, 1)).toBe(1);
});
