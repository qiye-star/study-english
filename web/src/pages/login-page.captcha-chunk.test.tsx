import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { LoginPage } from "./login-page";

// 外壳分块加载失败:登录页必须保持可用。这里的 import 被拒绝(见 components/captcha/loaders.ts 的说明)。
vi.mock("~/components/captcha/loaders", () => ({
  loadCaptchaField: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
  loadCaptchaWidget: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
}));

const USER = { id: "12345678", name: "alice", created_at: "t", access_token: "tok" };

function setup(mode: "off" | "adaptive" | "always") {
  const mock = createFetchMock({
    "GET /api/captcha/config": () => json({ mode }),
    "POST /api/sessions": () => json(USER),
  });
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/practice" element={<div>practice home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

async function logIn() {
  await userEvent.type(screen.getByTestId("login-username"), "alice");
  await userEvent.type(screen.getByTestId("login-password"), "password123");
  await userEvent.click(screen.getByTestId("login-submit"));
}

describe("LoginPage when the captcha chunk fails to load", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });

  it("with the mode always shows the existing load-failed text and retry button, keeping the form mounted", async () => {
    setup("always");
    expect(await screen.findByText("Could not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute("type", "button");
    expect(screen.getByTestId("login-username")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toBeInTheDocument();
  });

  it("with the mode off the form still submits and logs in", async () => {
    setup("off");
    await logIn();
    expect(await screen.findByText("practice home")).toBeInTheDocument();
  });

  it("with the mode adaptive and no 428 yet, no captcha is needed, so the form still logs in", async () => {
    setup("adaptive");
    await logIn();
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(screen.queryByText("Could not load")).toBeNull();
  });
});
