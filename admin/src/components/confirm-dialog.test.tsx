import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

it("requires the typed phrase and a reason before confirming", async () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open title="开放注册" body="危险" requireTyping="REGISTRATION_MODE" reasonRequired danger onConfirm={onConfirm} onClose={() => {}} />,
  );
  const button = screen.getByRole("button", { name: "确认" });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("输入 REGISTRATION_MODE 以确认"), "REGISTRATION_MODE");
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("理由"), "活动期间开放");
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(onConfirm).toHaveBeenCalledWith("活动期间开放");
});
