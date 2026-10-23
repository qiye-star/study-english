import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptchaField } from "./captcha-field";

// 组件分块加载失败(部署后 hash 变了、网络断开)时页面不能空白:分块的加载函数被拒绝。
vi.mock("./loaders", () => ({
  loadCaptchaWidget: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
  loadCaptchaField: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
}));

describe("CaptchaField when the widget chunk fails to load", () => {
  it("shows a retry message and a reload button instead of unmounting", async () => {
    render(
      <form>
        <input aria-label="still here" />
        <CaptchaField onPayload={() => undefined} />
      </form>,
    );
    expect(await screen.findByText("Verification failed. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("still here")).toBeInTheDocument();
  });
});
