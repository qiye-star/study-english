import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { RankRules } from "./api";
import { cloneRules } from "./rules-schema";
import { ScenariosTab } from "./rules-tabs/scenarios-tab";
import { defaultRules } from "./test-fixtures";

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [rules, setRules] = useState<RankRules>(defaultRules());
  const edit = (mutate: (d: RankRules) => void) =>
    setRules((cur) => {
      const next = cloneRules(cur);
      mutate(next);
      return next;
    });
  return <ScenariosTab rules={rules} base={defaultRules()} edit={edit} disabled={disabled} />;
}

it("marks a tier red when fewer than 2 scenarios stay enabled", async () => {
  render(<Harness />);
  const platinum = screen.getByTestId("pool-3");
  expect(within(platinum).getByText("启用 2 个")).toBeInTheDocument();
  expect(within(platinum).queryByText("至少需要 2 个")).toBeNull();
  await userEvent.click(within(platinum).getByLabelText("启用 platinum 情景 1"));
  expect(within(platinum).getByText("启用 1 个")).toHaveClass("text-bad");
  expect(within(platinum).getByText("至少需要 2 个")).toBeInTheDocument();
});

it("edits a scenario in the drawer", async () => {
  render(<Harness />);
  const gold = screen.getByTestId("pool-2");
  await userEvent.click(within(gold).getAllByRole("button", { name: "编辑" })[0]);
  const dialog = screen.getByRole("dialog");
  const title = within(dialog).getByLabelText("中文标题");
  await userEvent.clear(title);
  await userEvent.type(title, "酒店入住出了问题");
  await userEvent.click(within(dialog).getByRole("button", { name: "完成" }));
  expect(within(gold).getByText("酒店入住出了问题")).toBeInTheDocument();
});

it("is read-only when disabled", () => {
  render(<Harness disabled />);
  expect(screen.getByLabelText("启用 gold 情景 1")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "新增情景" })).toBeNull();
});
