import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { LetterDiff } from "./letter-diff";

beforeEach(() => { void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("LetterDiff", () => {
  it("marks missing, extra and wrong letters", () => {
    const { container } = render(<LetterDiff expected="talking" diff={[
      { op: "eq", a: "t", b: "t" }, { op: "eq", a: "a", b: "a" }, { op: "eq", a: "l", b: "l" }, { op: "eq", a: "k", b: "k" },
      { op: "del", a: "i", b: "" }, { op: "eq", a: "n", b: "n" }, { op: "eq", a: "g", b: "g" }]} />);
    const ops = [...container.querySelectorAll("[data-op]")].map((n) => `${n.getAttribute("data-op")}:${n.textContent}`);
    expect(ops).toEqual(["eq:t", "eq:a", "eq:l", "eq:k", "del:i", "eq:n", "eq:g"]);
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe("正确拼写 talking");
  });

  it("renders a substitution as typed-then-expected", () => {
    const { container } = render(<LetterDiff expected="cat" diff={[{ op: "eq", a: "c", b: "c" }, { op: "sub", a: "a", b: "u" }, { op: "eq", a: "t", b: "t" }]} />);
    const sub = container.querySelector("[data-op=sub]")!;
    expect(sub.querySelector("s")?.textContent).toBe("u");
    expect(sub.querySelector("u")?.textContent).toBe("a");
  });

  it("strikes extra typed letters", () => {
    const { container } = render(<LetterDiff expected="necessary" diff={[
      { op: "eq", a: "n", b: "n" }, { op: "eq", a: "e", b: "e" }, { op: "ins", a: "", b: "c" }, { op: "eq", a: "c", b: "c" }]} />);
    const ins = container.querySelector("[data-op=ins]")!;
    expect(ins.querySelector("s")?.textContent).toBe("c");
    expect(ins.querySelector("u")).toBeNull();
  });
});
