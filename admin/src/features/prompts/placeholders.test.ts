import { describe, expect, it } from "vitest";
import { checkPrompt, cleanPrompt, parsePlaceholders, templateRowProblems, type PromptRules } from "./placeholders";

const ASSIST: PromptRules = {
  kind: "text", required: ["chat", "draft", "level"], boundaries: ["<chat>", "</chat>", "<draft>", "</draft>"], maxChars: 8000,
};
const GRAMMAR: PromptRules = { kind: "text", required: [], boundaries: [], maxChars: 2000, formatted: false };
const TEMPLATES: PromptRules = { kind: "json", required: [], boundaries: [], maxChars: 200000 };
const OK = "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>";

describe("parsePlaceholders (mirrors Python string.Formatter().parse)", () => {
  it("parses fields and literal braces", () => {
    expect(parsePlaceholders("a {x} {{y}} {z.w} {q:>3} {}")).toEqual(["x", "z.w", "q:>3", "{}"]);
    expect(parsePlaceholders("{level:{draft}}")).toEqual(["level:{draft}"]);
  });
  it("rejects unbalanced braces", () => {
    expect(parsePlaceholders("a {")).toBeNull();
    expect(parsePlaceholders("a }")).toBeNull();
    expect(parsePlaceholders("{a")).toBeNull();
  });
});

describe("checkPrompt (same codes as the server)", () => {
  it("matches the server's validation codes", () => {
    expect(checkPrompt(GRAMMAR, "Flag article errors only.").errors).toEqual([]);
    expect(checkPrompt(GRAMMAR, " \u0000\n ").errors).toEqual(["empty"]);
    expect(checkPrompt(GRAMMAR, "x".repeat(2001)).errors).toEqual(["too_long"]);
    expect(checkPrompt(GRAMMAR, 'Reply like {"a": 1}').errors).toEqual([]);
    expect(checkPrompt(ASSIST, OK).errors).toEqual([]);
    expect(checkPrompt(ASSIST, OK + " {scenario}").errors).toEqual(["unknown_fields:scenario"]);
    expect(checkPrompt({ ...ASSIST, optional: ["scenario"] }, OK + " {scenario}").errors).toEqual([]);
    expect(checkPrompt(ASSIST, "Level {level}. <chat>{chat}</chat>").errors).toContain("missing_fields:draft");
    expect(checkPrompt(ASSIST, `${OK} {secret}`).errors).toContain("unknown_fields:secret");
    expect(checkPrompt(ASSIST, `${OK} {level.__class__}`).unknown).toEqual(["level.__class__"]);
    expect(checkPrompt(ASSIST, `${OK} {`).errors).toContain("invalid_braces");
    expect(checkPrompt(ASSIST, "Level {level}. <chat>{chat}</chat> {draft}").missingBoundaries).toEqual(["<draft>", "</draft>"]);
    expect(checkPrompt(TEMPLATES, "{").errors).toEqual(["invalid_json"]);
    expect(checkPrompt(TEMPLATES, JSON.stringify([{ key: "x" }])).errors).toEqual(["invalid_templates"]);
    expect(checkPrompt(TEMPLATES, JSON.stringify([{ key: "x", name: "X", description: "", prompt: "p" }])).errors).toEqual([]);
  });
  it("counts code points like Python len()", () => {
    expect(checkPrompt(GRAMMAR, "😀😀").length).toBe(2);
    expect(cleanPrompt(`a\r\nb${String.fromCharCode(0x2028)}`)).toBe("a\nb");
  });
});

it("flags bad and duplicate template rows", () => {
  const row = { key: "a", name: "A", description: "", prompt: "p" };
  expect(templateRowProblems([row, row, { ...row, key: "Bad Key", name: "" }])).toEqual({ 1: ["duplicate"], 2: ["key", "name"] });
});
