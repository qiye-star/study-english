import { render, screen, act } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { CaptchaWidget, type CaptchaHandle } from "./captcha-widget";

// 组件本体的 import 只在测试里替换:真正的 altcha 在 jsdom 里不运行(它需要 WebCrypto 与真实元素)。
vi.mock("altcha", () => ({}));
vi.mock("altcha/i18n/en", () => ({}));
vi.mock("altcha/i18n/zh-cn", () => ({}));

const calls = {
  configure: [] as unknown[],
  reset: 0,
  verify: 0,
  /** true 时假元素的 reset 会像真实 altcha 一样回报 statechange(unverified),用于验证卸载时不回传载荷。 */
  emitStateOnReset: false,
};
// 未升级(upgraded=false)时导出的方法是 undefined,与真实 altcha 在 connectedCallback 的微任务之前一致。
const upgrade = { done: true };
/** 记录假元素上监听器的增删,用于断言 StrictMode 下“同时只有一套监听器”。 */
const listenerLog: Array<{ op: "add" | "remove"; type: string }> = [];
const TRACKED = ["verified", "expired", "statechange"];

/** 测试用的假 <altcha-widget>:记录对它的方法调用;事件由测试直接派发。 */
class FakeAltcha extends HTMLElement {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (TRACKED.includes(type)) listenerLog.push({ op: "add", type });
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    if (TRACKED.includes(type)) listenerLog.push({ op: "remove", type });
    super.removeEventListener(type, listener, options);
  }
  get configure() {
    return upgrade.done ? (options: unknown) => calls.configure.push(options) : undefined;
  }
  get reset() {
    return upgrade.done
      ? () => {
          calls.reset += 1;
          if (calls.emitStateOnReset) this.dispatchEvent(new CustomEvent("statechange", { detail: { state: "unverified" } }));
        }
      : undefined;
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

  it("clears the payload on a statechange to error and adds no second message (altcha shows its own error text)", () => {
    const { el, onPayload } = renderWidget();
    act(() => {
      el.dispatchEvent(new CustomEvent("statechange", { detail: { state: "error", payload: null } }));
    });
    expect(onPayload).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(i18n.t("web.captcha.failed"))).toBeNull();
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

describe("CaptchaWidget unmount (group 3)", () => {
  beforeEach(() => {
    calls.reset = 0;
    calls.emitStateOnReset = false;
  });
  afterEach(() => {
    calls.emitStateOnReset = false;
  });

  it("unmounting resets the element, which aborts a running solve, and emits no payload afterwards", () => {
    const onPayload = vi.fn();
    const { unmount, el } = renderWidget(onPayload);
    const before = onPayload.mock.calls.length;
    unmount();
    expect(calls.reset).toBe(1);
    el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "LATE" } }));
    expect(onPayload.mock.calls.length).toBe(before);
  });

  it("unmount resets exactly once; the statechange that the reset reports, and any later verified or statechange, reach nobody", () => {
    calls.emitStateOnReset = true;
    const onPayload = vi.fn();
    const { unmount, el } = renderWidget(onPayload);
    const before = onPayload.mock.calls.length;
    unmount();
    expect(calls.reset).toBe(1);
    el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "LATE" } }));
    el.dispatchEvent(new CustomEvent("statechange", { detail: { state: "error" } }));
    expect(onPayload.mock.calls.length).toBe(before);
  });
});

describe("CaptchaWidget callback identity (regression: re-render must not reset the solve)", () => {
  beforeEach(() => {
    calls.reset = 0;
    calls.verify = 0;
    listenerLog.length = 0;
  });

  it("a re-render with a new onPayload identity neither resets the element nor clears the payload; the newest callback gets the next payload", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<CaptchaHandle>();
    const { el, rerender } = renderWidget(first, ref);
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "P1" } }));
    });
    expect(first).toHaveBeenLastCalledWith("P1");

    // 父组件每次渲染都会给出新的回调函数(与 use-captcha-gate 的 setPayload 行为一致)。
    rerender(<CaptchaWidget ref={ref} onPayload={second} />);
    expect(calls.reset).toBe(0);
    expect(second).not.toHaveBeenCalledWith(null);
    expect(first.mock.calls.filter(([value]) => value === null)).toHaveLength(0);

    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "P2" } }));
    });
    expect(second).toHaveBeenLastCalledWith("P2");
    expect(first).not.toHaveBeenCalledWith("P2");
    expect(calls.reset).toBe(0);
  });

  it("re-rendering a few times in a row still delivers the payload exactly once to the current callback", () => {
    const first = vi.fn();
    const ref = createRef<CaptchaHandle>();
    const { el, rerender } = renderWidget(first, ref);
    for (let i = 0; i < 3; i += 1) {
      rerender(<CaptchaWidget ref={ref} onPayload={vi.fn()} />);
    }
    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "P" } }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(calls.reset).toBe(0);
  });
});

describe("CaptchaWidget StrictMode (dev double-invoked effects)", () => {
  beforeEach(() => {
    calls.reset = 0;
    listenerLog.length = 0;
  });

  it("after StrictMode's mount, cleanup, mount there is exactly one active set of listeners and the payload still arrives once", () => {
    const onPayload = vi.fn();
    const ref = createRef<CaptchaHandle>();
    const utils = render(
      <StrictMode>
        <CaptchaWidget ref={ref} onPayload={onPayload} />
      </StrictMode>,
    );
    const el = utils.container.querySelector("altcha-widget") as HTMLElement;

    // 每种事件:添加次数减去移除次数 = 当前有效的监听器数,必须正好为 1。
    for (const type of TRACKED) {
      const active = listenerLog.reduce((n, entry) => {
        if (entry.type !== type) return n;
        return entry.op === "add" ? n + 1 : n - 1;
      }, 0);
      expect(active, type).toBe(1);
    }

    act(() => {
      el.dispatchEvent(new CustomEvent("verified", { detail: { payload: "STRICT" } }));
    });
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload).toHaveBeenCalledWith("STRICT");
    utils.unmount();
  });
});
