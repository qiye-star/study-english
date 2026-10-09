import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SimulatePanel } from "./simulate-panel";
import { impactFixture } from "./test-fixtures";

it("shows current → draft for the six metrics and an amber note on verdict flips", () => {
  render(<SimulatePanel impact={impactFixture()} loading={false} error={null} dirty={false} baseLabel="v3" canRun onRun={() => {}} />);
  expect(screen.getByTestId("sim-gate")).toHaveTextContent("段位门12→9↓3");
  expect(screen.getByTestId("sim-clamped")).toHaveTextContent("被截断3 人");
  expect(screen.getByTestId("sim-capped")).toHaveTextContent("触顶用户日18%→6%");
  expect(screen.getByTestId("sim-pass-to-fail")).toHaveTextContent("通过→未通过2 场");
  expect(screen.getByTestId("sim-flip-note")).toHaveTextContent("仅提示,不改历史");
  expect(screen.getByTestId("sim-pool")).toHaveTextContent("王者1");
  expect(screen.getByTestId("sim-pace")).toHaveTextContent("黄金6–9 天 → 5–8 天");
  expect(screen.getByText("当前 v3 → 草稿 · 只读")).toBeInTheDocument();
});

it("hides the flip note when nothing flips and runs on demand", async () => {
  const onRun = vi.fn();
  const impact = { ...impactFixture(), verdicts: { matches: 4, passToFail: 0, failToPass: 0 } };
  const { rerender } = render(<SimulatePanel impact={impact} loading={false} error={null} dirty baseLabel="v0" canRun onRun={onRun} />);
  expect(screen.queryByTestId("sim-flip-note")).toBeNull();
  expect(screen.getByText("预演基于已保存的草稿;有未保存的修改。")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重新计算" }));
  expect(onRun).toHaveBeenCalled();
  rerender(<SimulatePanel impact={null} loading={false} error="boom" dirty={false} baseLabel="v0" canRun={false} onRun={onRun} />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByRole("button")).toBeNull();
});
