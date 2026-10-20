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
// 未升级(upgraded=false)时导出的方法是 undefined,与真实 altcha 在 connectedCallback 的微任务之前一致。
const upgrade = { done: true };

/** 测试用的假 <altcha-widget>:记录对它的方法调用;事件由测试直接派发。 */
class FakeAltcha extends HTMLElement {
  get configure() {
    return upgrade.done ? (options: unknown) => calls.configure.push(options) : undefined;
  }
  get reset() {
    return upgrade.done ? () => { calls.reset += 1; } : undefined;
  }
  get verify() {
    return upgrade.done ? () => { calls.verify += 1; return Promise.resolve(null); } : undefined;
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

  it("mounts without throwing while the element is not upgraded yet, and hides the footer on its load event", () => {
    upgrade.done = false;
    try {
      const { el } = renderWidget();
      expect(calls.configure).toHaveLength(0);
      act(() => {
        upgrade.done = true;
        el.dispatchEvent(new Event("load"));
      });
      expect(calls.configure).toContainEqual({ hideFooter: true });
    } finally {
      upgrade.done = true;
    }
  });

  it("reset() and reset({ again: true }) before the element is upgraded neither throw nor unmount the tree", () => {
    upgrade.done = false;
    try {
      const { ref, el } = renderWidget();
      expect(() => act(() => ref.current?.reset())).not.toThrow();
      expect(() => act(() => ref.current?.reset({ again: true }))).not.toThrow();
      expect(document.body.contains(el)).toBe(true);
    } finally {
      upgrade.done = true;
    }
  });

  it("keeps altcha's hidden payload field out of the surrounding form's data and form owner", () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    const root = render(<CaptchaWidget ref={createRef<CaptchaHandle>()} onPayload={vi.fn()} />, { container: form });
    const el = form.querySelector("altcha-widget") as HTMLElement;
    // altcha 没有 shadow DOM:隐藏字段渲染在组件的 light DOM 里,名称与 form 属性取自元素自身的属性。
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = el.getAttribute("name") ?? "altcha";
    field.setAttribute("form", el.getAttribute("form") ?? "");
    field.value = SECRET_PAYLOAD;
    el.appendChild(field);
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: SECRET_PAYLOAD } }));
    });
    const owner = el.getAttribute("form") ?? "";
    expect(owner).not.toBe("");
    expect(document.getElementById(owner)).toBeNull();
    expect(el.getAttribute("name")).toBe("");
    expect(field.form).toBeNull();
    expect([...new FormData(form).values()]).not.toContain(SECRET_PAYLOAD);
    for (const input of Array.from(form.querySelectorAll("input"))) {
      if (input.value.includes(SECRET_PAYLOAD)) {
        expect(input.form).toBeNull();
        expect(input.name).toBe("");
      }
    }
    root.unmount();
    form.remove();
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
