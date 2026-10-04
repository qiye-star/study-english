import { describe, expect, it } from "vitest";
import { DICTIONARY_PROMPT, TRANSLATION_PROMPT, TRANSLATION_SYSTEM_PROMPT, extractPrompt, renderTemplate } from "./prompts";

describe("prompts reused from enjoy/src/commands", () => {
  it("extracts the desktop prompts", () => {
    expect(DICTIONARY_PROMPT.startsWith("You are an {learning_language}-{native_language} dictionary.")).toBe(true);
    expect(DICTIONARY_PROMPT).toContain('"context_translation": "translation of the context in {native_language}"');
    expect(TRANSLATION_SYSTEM_PROMPT).toBe("You are a professional, authentic translation engine, only returns translations.");
    expect(TRANSLATION_PROMPT.startsWith("Translate the text to {native_language} Language")).toBe(true);
    expect(TRANSLATION_PROMPT).toContain("{text}");
  });
  it("fails loudly when the source changes shape", () => {
    expect(() => extractPrompt("const X = 1;", /const Y = `([\s\S]*?)`;/, "Y")).toThrow("Prompt Y not found");
  });
  it("rejects an empty or whitespace-only capture", () => {
    expect(() => extractPrompt("const Y = `   `;", /const Y = `([\s\S]*?)`;/, "Y")).toThrow("Prompt Y not found");
  });
  it("renders LangChain-style templates", () => {
    expect(renderTemplate("A {x} {{literal}} {missing}", { x: "1" })).toBe("A 1 {literal} {missing}");
    const rendered = renderTemplate(DICTIONARY_PROMPT, { learning_language: "English (United States)", native_language: "普通话" });
    expect(rendered).toContain("You are an English (United States)-普通话 dictionary.");
    expect(rendered).toContain('{\n  "word"');
    expect(rendered).not.toMatch(/\{\{|\}\}/);
  });
});
