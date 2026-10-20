import { render, screen, act } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { CaptchaWidget, type CaptchaHandle } from "./captcha-widget";

// 组件本体的 import 只在测试里替换:真正的 altcha 在 jsdom 里不运行(它需要 WebCrypto 与真实元素)。
vi.mock("altcha", () => ({}));
vi.mock("altcha/i18n/en", () => ({}));
vi.mock("altcha/i18n/zh-cn", () => ({}));

const calls = { configure: [] as unknown[], reset: 0, verify: 0 };

/** 测试用的假 <altcha-widget>:记录对它的方法调用;事件由测试直接派发。 */
class FakeAltcha extends HTMLElement {
  configure(options: unknown) {
    calls.configure.push(options);
  }
  reset() {
    calls.reset += 1;
  }
  verify() {
    calls.verify += 1;
    return Promise.resolve(null);
  }
}
if (!customElements.get("altcha-widget")) customElements.define("altcha-widget", FakeAltcha);

const SECRET_PAYLOAD = "PAYLOAD-THAT-MUST-NOT-SHOW-" + "x".repeat(16);

function renderWidget(onPayload = vi.fn(), ref = createRef<CaptchaHandle>()) {
  const utils = render(<CaptchaWidget ref={ref} onPayload={onPayload} />);
  const el = utils.container.querySelector("altcha-widget") as FakeAltcha;
  return { ...utils, el, onPayload, ref };
}

describe("CaptchaWidget", () => {
  beforeEach(() => {
    calls.configure.length = 0;
    calls.reset = 0;
    calls.verify = 0;
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the element with the challenge path, auto off and the English language code", () => {
    const { el } = renderWidget();
    expect(el.getAttribute("challenge")).toBe("/api/captcha/challenge");
    expect(el.getAttribute("auto")).toBe("off");
    expect(el.getAttribute("language")).toBe("en");
  });

  it("maps the Chinese UI to the widget's zh-cn language pack", async () => {
    await i18n.changeLanguage("zh-CN");
    const { el } = renderWidget();
    expect(el.getAttribute("language")).toBe("zh-cn");
  });

  it("hides the footer on mount", () => {
    renderWidget();
    expect(calls.configure).toContainEqual({ hideFooter: true });
  });

  it("passes the solved payload to onPayload on verified", () => {
    const { el, onPayload } = renderWidget();
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "P" } }));
    });
    expect(onPayload).toHaveBeenLastCalledWith("P");
  });

  it("clears the payload on expired", () => {
    const { el, onPayload } = renderWidget();
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "P" } }));
      el.dispatchEvent(new CustomEvent("expired"));
    });
    expect(onPayload).toHaveBeenLastCalledWith(null);
  });

  it("clears the payload and shows the failure message on a statechange to error", () => {
    const { el, onPayload } = renderWidget();
    act(() => {
      el.dispatchEvent(new CustomEvent("statechange", { detail: { state: "error", payload: null } }));
    });
    expect(onPayload).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("web.captcha.failed"));
  });

  it("reset() resets the element without solving again; reset({ again: true }) also starts a new solve", () => {
    const { ref } = renderWidget();
    act(() => ref.current?.reset());
    expect(calls.reset).toBe(1);
    expect(calls.verify).toBe(0);
    act(() => ref.current?.reset({ again: true }));
    expect(calls.reset).toBe(2);
    expect(calls.verify).toBe(1);
  });

  it("never shows the payload as text and never writes it to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { el } = renderWidget();
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: SECRET_PAYLOAD } }));
    });
    expect(document.body.textContent ?? "").not.toContain(SECRET_PAYLOAD);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
