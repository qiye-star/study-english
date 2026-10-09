import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import { LoginPage } from "./login-page";

vi.mock("../api/endpoints", () => ({ login: vi.fn(), loginTotp: vi.fn(), getSession: vi.fn() }));

it("asks for a TOTP code when the server requires it", async () => {
  vi.mocked(endpoints.login).mockResolvedValue({ mfaRequired: true } as never);
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText("账号"), "ops");
  await userEvent.type(screen.getByLabelText("密码"), "long-enough-password-1");
  await userEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByLabelText("验证码或恢复码")).toBeInTheDocument();
});
