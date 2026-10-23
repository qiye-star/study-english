import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { CaptchaField } from "./captcha-field";

// 组件分块的加载次数:只有真正渲染到组件时才会 import 它(R-C12 懒加载)。
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./captcha-widget", async () => {
  const React = await import("react");
  loads.count += 1;
  return {
    CaptchaWidget: React.forwardRef((_props: { onPayload: (p: string | null) => void }, _ref) =>
      React.createElement("div", { "data-testid": "widget-stub" }),
    ),
  };
});

describe("CaptchaField", () => {
  afterEach(() => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  });

  it("does not load the widget chunk until it is rendered", async () => {
    const before = loads.count;
    expect(before).toBe(0);
    render(<CaptchaField onPayload={() => undefined} />);
    expect(screen.getByRole("group", { name: "Human verification" })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("widget-stub")).toBeInTheDocument());
    expect(loads.count).toBe(1);
  });

  it("renders no widget and shows an HTTPS notice in an insecure context, without loading the chunk", () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    const before = loads.count;
    render(<CaptchaField onPayload={() => undefined} />);
    expect(screen.queryByTestId("widget-stub")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Human verification needs HTTPS");
    expect(loads.count).toBe(before);
  });

  it("does not write anything to localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { unmount } = render(<CaptchaField onPayload={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("widget-stub")).toBeInTheDocument());
    act(() => fireEvent.click(document.body));
    expect(setItem).not.toHaveBeenCalled();
    unmount();
    setItem.mockRestore();
  });
});
