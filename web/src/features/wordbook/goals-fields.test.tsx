import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { GoalsFields, applyPatch, valueOf, type GoalsValue } from "./goals-fields";
import { LIMITS } from "./goals-test-fixtures";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function setup(value: Partial<GoalsValue> = {}, extra: Partial<Parameters<typeof GoalsFields>[0]> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <GoalsFields value={{ dailyNew: 20, reviewCap: 200, orderMode: "shuffle", ...value }} limits={LIMITS} remaining={3684} onChange={onChange} {...extra} />,
  );
  return onChange;
}

describe("GoalsFields", () => {
  it("selects the matching plan and shows its estimate", () => {
    setup();
    const plans = screen.getByRole("radiogroup", { name: "方案" });
    const standard = within(plans).getByRole("radio", { name: /标准/ });
    expect(standard).toHaveAttribute("aria-checked", "true");
    expect(standard).toHaveTextContent("约 185 天学完");
    expect(standard).toHaveTextContent("稳定后每天复习约 100");
    expect(standard.className).toContain("min-h-[56px]");
    expect(within(plans).getByRole("radio", { name: /轻松/ })).toHaveTextContent("约 369 天学完");
    expect(within(plans).getByRole("radio", { name: /冲刺/ })).toHaveTextContent("新词 50 · 复习 不限");
    expect(within(plans).getByRole("radio", { name: /冲刺/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("goals-preset-custom")).toBeNull();
    // 不在自定义时没有步进器
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves both values when a plan is picked", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("radio", { name: /冲刺/ }));
    expect(onChange).toHaveBeenCalledWith({ dailyNew: 50, reviewUnlimited: true });
    await userEvent.click(screen.getByRole("radio", { name: /轻松/ }));
    expect(onChange).toHaveBeenLastCalledWith({ dailyNew: 10, reviewCap: 100 });
  });

  it("opens the stepper for a custom value and warns when reviews would pile up", () => {
    setup({ dailyNew: 35, reviewCap: 100 });
    expect(screen.getByTestId("goals-preset-custom")).toHaveTextContent("自定义");
    const daily = screen.getByRole("radiogroup", { name: "每日新词" });
    expect(within(daily).getByRole("radio", { name: "自定义" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "每日新词" })).toHaveValue("35");
    expect(screen.getByTestId("goals-estimate")).toHaveTextContent("按这个设置约 106 天学完 · 稳定后每天复习约 175 个");
    expect(screen.getByTestId("goals-estimate")).toHaveTextContent("学到最后约 219 个");
    expect(screen.getByTestId("goals-overcap")).toHaveTextContent("高于复习上限 100,复习会积压");
  });

  it("previews today and explains the backlog guard", () => {
    setup({ reviewCap: 100 }, { today: { newDone: 3, reviewDone: 0, reviewDue: 240, bonus: 0 } });
    expect(screen.getByTestId("goals-today")).toHaveTextContent("新词 3 / 20 · 还能学 2 个");
    expect(screen.getByTestId("goals-today")).toHaveTextContent("复习 0 / 100");
    expect(screen.getByTestId("goals-backlog")).toHaveTextContent("到期 240 个,超过复习上限 100:今天新词最多 5 个");
  });

  it("previews unlimited reviews against everything due", () => {
    setup({ dailyNew: 50, reviewCap: null }, { today: { newDone: 8, reviewDone: 0, reviewDue: 34, bonus: 0 } });
    expect(screen.getByTestId("goals-today")).toHaveTextContent("新词 8 / 50 · 还能学 42 个");
    expect(screen.getByTestId("goals-today")).toHaveTextContent("复习 0 · 到期 34(不限)");
    expect(within(screen.getByRole("radiogroup", { name: "每日复习上限" })).getByRole("radio", { name: "不限" }))
      .toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("goals-overcap")).toBeNull();
  });

  it("commits a custom review limit through the stepper", async () => {
    const onChange = setup();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "每日复习上限" })).getByRole("radio", { name: "自定义" }));
    const input = screen.getByRole("textbox", { name: "每日复习上限" });
    await userEvent.clear(input);
    await userEvent.type(input, "350{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ reviewCap: 350 });
  });

  it("respects the admin's limits", () => {
    setup({ dailyNew: 20, reviewCap: 100 }, { limits: { ...LIMITS, dailyNew: { min: 1, max: 30 }, reviewUnlimited: false } });
    const review = screen.getByRole("radiogroup", { name: "每日复习上限" });
    expect(within(review).queryByRole("radio", { name: "不限" })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "每日新词" })).getAllByRole("radio").map((r) => r.textContent))
      .toEqual(["10", "20", "30", "自定义"]);
    const sprint = screen.getByRole("radio", { name: /冲刺/ });
    expect(sprint).toBeDisabled();
    expect(sprint).toHaveTextContent("管理员已限制");
  });

  it("applies patches to a draft value (books page)", () => {
    const v: GoalsValue = { dailyNew: 20, reviewCap: 100, orderMode: "shuffle" };
    expect(applyPatch(v, { reviewUnlimited: true })).toEqual({ ...v, reviewCap: null });
    expect(applyPatch({ ...v, reviewCap: null }, { reviewCap: 50, dailyNew: 10 })).toEqual({ dailyNew: 10, reviewCap: 50, orderMode: "shuffle" });
    expect(applyPatch(v, { orderMode: "book" })).toEqual({ ...v, orderMode: "book" });
  });

  it("reads unlimited from the server's sentinel", () => {
    expect(valueOf({ dailyNew: 20, reviewCap: 0, reviewUnlimited: true, orderMode: "book" })).toEqual({ dailyNew: 20, reviewCap: null, orderMode: "book" });
    expect(valueOf({ dailyNew: 20, reviewCap: 100 })).toEqual({ dailyNew: 20, reviewCap: 100, orderMode: "shuffle" });
  });
});
