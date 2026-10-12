import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO } from "./fixtures";
import { TargetRow, type TargetRowProps } from "./target-row";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const setup = (over: Partial<TargetRowProps> = {}) => {
  const props: TargetRowProps = { agents: [EMMA], activeId: EMMA.id, on: false, block: null, recipient: null, disabled: false, onToggle: vi.fn(), ...over };
  renderWithProviders(<TargetRow {...props} />);
  return props;
};

it("shows 对 Emma 说 as a toggle and the standing hint while it is on", () => {
  const p = setup();
  const chip = screen.getByRole("button", { name: "对 Emma 说" });
  expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("");
  fireEvent.click(chip);
  expect(p.onToggle).toHaveBeenCalledWith(EMMA.id);
});

it("says where the message goes: the target, or the agent being replied to", () => {
  setup({ on: true, recipient: { personaId: EMMA.id, name: "Emma", via: "target" } });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("消息会交给 Emma");
});

it("shows the reply cue", () => {
  setup({ recipient: { personaId: LEO.id, name: "Leo", via: "reply" } });
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("回复 Leo 中 · 消息会交给 Leo");
});

it("is a two-way picker with two agents", () => {
  const p = setup({ agents: [EMMA, LEO], on: true, activeId: LEO.id });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "对 Leo 说" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "对 Emma 说" }));
  expect(p.onToggle).toHaveBeenCalledWith(EMMA.id);
});

it("greys the chips out with the reason (muted / AI off / disabled persona)", () => {
  setup({ on: true, block: "muted" });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("本房 AI 已被管理员关闭");
});

it("names the disabled persona and keeps labels from widening a 360 px row", () => {
  setup({ block: "agentOff" });
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("Emma 已停用");
  expect(screen.getByTestId("room-target-chip").className).toContain("max-w-[132px]");
  expect(screen.getByTestId("room-target-status").className).toContain("truncate");
});

it("renders nothing without agents and without a reply cue", () => {
  renderWithProviders(<TargetRow agents={[]} activeId={null} on={false} block={null} recipient={null} disabled={false} onToggle={() => {}} />);
  expect(screen.queryByTestId("room-target-row")).toBeNull();
});
