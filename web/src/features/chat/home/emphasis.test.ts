import { describe, expect, it } from "vitest";
import { parseEmphasis, stripEmphasis } from "./emphasis";

const ems = (line: string) => parseEmphasis(line).filter((p) => p.em).map((p) => p.text);

describe("emphasis (R17 / FR19)", () => {
  it("parses the demo's three English lines (line 2 has three emphases)", () => {
    expect(ems("It's Friday morning, and you're on a *23-day streak* — that steady effort really adds up.")).toEqual(["23-day streak"]);
    expect(ems("You have *12 words* due for review, and yesterday's slip was *went* — the right form is *gone*.")).toEqual(["12 words", "went", "gone"]);
    expect(ems("Today, let's spend *10 minutes* telling three short stories.")).toEqual(["10 minutes"]);
  });

  it("parses Chinese lines and keeps the text order", () => {
    expect(parseEmphasis("你已经连续学了 *23 天*,真棒。")).toEqual([
      { text: "你已经连续学了 ", em: false }, { text: "23 天", em: true }, { text: ",真棒。", em: false },
    ]);
  });

  it("normalises **x** to *x*", () => {
    expect(parseEmphasis("a **b** c")).toEqual([{ text: "a ", em: false }, { text: "b", em: true }, { text: " c", em: false }]);
  });

  it.each([
    ["four marks", "*a* *b* *c* *d*"],
    ["an unpaired star", "a *b"],
    ["an empty pair", "a ** b"],
    ["content of 25 characters", `x *${"a".repeat(25)}* y`],
    ["content with <", "x *a<b* y"],
    ["content with a newline", "x *a\nb* y"],
  ])("%s -> the whole line is plain text without any asterisk", (_name, line) => {
    const parts = parseEmphasis(line);
    expect(parts.every((p) => !p.em)).toBe(true);
    expect(parts.map((p) => p.text).join("")).toBe(line.replace(/\*/g, ""));
  });

  it("24 characters is still valid", () => {
    expect(ems(`x *${"a".repeat(24)}* y`)).toEqual(["a".repeat(24)]);
  });

  it("stripEmphasis removes every marker", () => {
    expect(stripEmphasis("You have *12 words* due.")).toBe("You have 12 words due.");
    expect(stripEmphasis("plain")).toBe("plain");
    expect(stripEmphasis("")).toBe("");
  });

  it("html-looking text stays text (no markup is interpreted)", () => {
    expect(parseEmphasis("<b>x</b>")).toEqual([{ text: "<b>x</b>", em: false }]);
  });
});
