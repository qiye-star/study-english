import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EmphasisText } from "./emphasis-text";
import { parseEmphasis, stripEmphasis } from "./emphasis";

// 演示页(docs/design/chat-home-demo-v2.html)的三段英文原文,第 2 段 3 处强调
const DEMO = [
  "Good morning! It's Friday, and you're on a *23-day streak* — that steady effort really adds up.",
  "You have *12 words* to review, and yesterday *went* slipped in for *gone*.",
  "Let's spend 10 minutes on the present perfect, then run through your review words.",
];

const ems = (s: string) => parseEmphasis(s).filter((p) => p.em).map((p) => p.text);

describe("parseEmphasis (R17 / FR19)", () => {
  it("parses the demo lines", () => {
    expect(ems(DEMO[0])).toEqual(["23-day streak"]);
    expect(ems(DEMO[1])).toEqual(["12 words", "went", "gone"]);
    expect(parseEmphasis(DEMO[2])).toEqual([{ text: DEMO[2], em: false }]);
  });

  it("normalises **x** to *x*", () => {
    expect(parseEmphasis("a **b** c")).toEqual([{ text: "a ", em: false }, { text: "b", em: true }, { text: " c", em: false }]);
  });

  it.each([
    ["four marks", "*a* *b* *c* *d*"],
    ["unpaired", "a *b c"],
    ["empty marks", "a ** b"],
    ["empty marks inside", "a **** b"],
    ["25 chars", `a *${"x".repeat(25)}* b`],
    ["angle bracket", "a *<b>* c"],
    ["newline", "a *b\nc* d"],
  ])("a violation (%s) makes the whole line plain text without stars", (_, line) => {
    const parts = parseEmphasis(line);
    expect(parts.every((p) => !p.em)).toBe(true);
    expect(parts.map((p) => p.text).join("")).not.toContain("*");
  });

  it("accepts exactly 24 characters and three marks", () => {
    expect(ems(`*${"x".repeat(24)}*`)).toHaveLength(1);
    expect(ems("*a* *b* *c*")).toEqual(["a", "b", "c"]);
  });

  it("stripEmphasis removes every mark", () => {
    expect(stripEmphasis(DEMO[1])).toBe("You have 12 words to review, and yesterday went slipped in for gone.");
    expect(stripEmphasis("")).toBe("");
  });
});

describe("EmphasisText", () => {
  it("renders marks as <em> and never interprets HTML", () => {
    const { container } = render(<p><EmphasisText text={"say *have gone* <b>now</b> <img src=x onerror=alert(1)>"} /></p>);
    expect(container.querySelectorAll("em.greet-em")).toHaveLength(1);
    expect(container.querySelector("em")?.textContent).toBe("have gone");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<b>now</b>");
  });

  it("does not turn an HTML-bearing mark into elements (violation = plain text)", () => {
    const { container } = render(<p><EmphasisText text={"*<script>x</script>*"} /></p>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("em")).toBeNull();
  });
});

describe("home/ source", () => {
  it("never uses dangerouslySetInnerHTML", () => {
    const dir = path.resolve(process.cwd(), "src/features/chat/home") + path.sep;
    for (const file of readdirSync(dir).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f))) {
      expect(readFileSync(dir + file, "utf8"), file).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
