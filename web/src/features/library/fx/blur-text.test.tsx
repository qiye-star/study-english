import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLUR_TEXT_MAX_TOKENS, BlurText, splitBlurTokens } from "./blur-text";

afterEach(() => vi.restoreAllMocks());

describe("splitBlurTokens", () => {
  it("splits English into words, keeps spaces as plain tokens and splits CJK per character", () => {
    expect(splitBlurTokens("Hi there")).toEqual(["Hi", " ", "there"]);
    expect(splitBlurTokens("你好 world")).toEqual(["你", "好", " ", "world"]);
    expect(splitBlurTokens("")).toEqual([]);
  });
});

describe("BlurText (spec §11.4a)", () => {
  it("fades each word in turn and keeps the whole text for assistive tech", () => {
    const { container } = render(<BlurText text="So what now" stepMs={40} />);
    const words = [...container.querySelectorAll(".lib-bw")];
    expect(words.map((w) => w.textContent)).toEqual(["So", "what", "now"]);
    expect(words.map((w) => (w as HTMLElement).style.getPropertyValue("--d"))).toEqual(["0ms", "40ms", "80ms"]);
    expect(container.querySelector(".sr-only")).toHaveTextContent("So what now");
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("caps the delay so a long answer does not take seconds to appear", () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    const { container } = render(<BlurText text={text} stepMs={100} />);
    const last = [...container.querySelectorAll(".lib-bw")].pop() as HTMLElement;
    expect(last.style.getPropertyValue("--d")).toBe("2400ms");
  });

  it("renders plain text when there are too many tokens", () => {
    const text = Array.from({ length: BLUR_TEXT_MAX_TOKENS + 5 }, (_, i) => `w${i}`).join(" ");
    const { container } = render(<BlurText text={text} />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
    expect(container).toHaveTextContent("w0 w1");
  });

  it("renders plain text when motion is off (reduced motion, low-end device or enabled={false})", () => {
    const { container, rerender } = render(<BlurText text="So what now" enabled={false} />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
    expect(screen.getByText("So what now")).toBeInTheDocument();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    rerender(<BlurText text="So what now" />);
    expect(container.querySelectorAll(".lib-bw")).toHaveLength(0);
  });
});
