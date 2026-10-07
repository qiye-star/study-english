import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ABBREVIATIONS } from "./sentences";
import { MAX_SENTENCE_CHARS, createSentenceStream, splitForSpeech } from "./sentence-stream";

type Case = { text: string; sentences: string[] };
// vitest runs from web/ (jsdom: import.meta.url is not a file URL), so resolve relative to the cwd.
const FIXTURE = resolve(process.cwd(), "../server/tests/fixtures/sentence_cases.json");
const HAVE_FIXTURE = existsSync(FIXTURE);
if (!HAVE_FIXTURE) console.warn(`sentence_cases.json missing at ${FIXTURE}; shared conformance tests are skipped`);
const CASES: Case[] = HAVE_FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : [];

const WORDS = ["hello", "world", "Mr.", "Dr.", "v3.14", "e.g.", "coffee", "please", "\"quoted\"", "really", "you", "tomorrow"];
const ENDINGS = [".", "!", "?", "?!", ".\"", "...", "…", "。"];
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const normalized = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** 逐块喂累计全文,返回所有输出(含 flush)。 */
function streamed(text: string, sizes: () => number): string[] {
  const s = createSentenceStream();
  const out: string[] = [];
  for (let i = sizes(); i < text.length; i += sizes()) out.push(...s.push(text.slice(0, i)));
  out.push(...s.push(text), ...s.flush());
  return out;
}

describe.skipIf(!HAVE_FIXTURE)("shared conformance cases (plan R7)", () => {
  it("fixture is non-empty", () => expect(CASES.length).toBeGreaterThan(0));

  it.each(CASES.map((c) => [c.text, c.sentences] as const))("whole text %j", (text, sentences) => {
    expect(splitForSpeech(text)).toEqual(sentences);
  });

  it.each(CASES.map((c) => [c.text, c.sentences] as const))("char by char %j", (text, sentences) => {
    expect(streamed(text, () => 1)).toEqual(sentences);
  });

  it.each(CASES.map((c, i) => [i, c.text, c.sentences] as const))("random seeded chunkings #%i %j", (i, text, sentences) => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(i * 1000 + seed);
      expect(streamed(text, () => 1 + Math.floor(r() * 7))).toEqual(sentences);
    }
  });
});

describe("abbreviation table", () => {
  it("is the one shared with sentences.ts (same size as the server table)", () => {
    expect(ABBREVIATIONS.size).toBe(30);
    expect(ABBREVIATIONS.has("e.g")).toBe(true);
  });
});

describe("createSentenceStream", () => {
  it("takes the cumulative text and only emits complete sentences", () => {
    const s = createSentenceStream();
    expect(s.push("Hello there.")).toEqual([]);
    expect(s.push("Hello there. How")).toEqual(["Hello there."]);
    expect(s.push("Hello there. How are you?")).toEqual([]);
    expect(s.flush()).toEqual(["How are you?"]);
  });

  it("restarts when the text is not a continuation", () => {
    const s = createSentenceStream();
    s.push("Old text. More");
    expect(s.push("New start. Next")).toEqual(["New start."]);
  });

  it("cuts long sentences", () => {
    expect(splitForSpeech("x".repeat(450))).toEqual(["x".repeat(200), "x".repeat(200), "x".repeat(50)]);
  });

  it.each(Array.from({ length: 100 }, (_, i) => i))("random text %i: chunking does not matter and nothing is lost", (seed) => {
    const r = rng(seed + 1);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const sentences = Array.from({ length: 1 + Math.floor(r() * 8) }, () =>
      `${pick(["Hello", "Okay", "Yes", "Coffee"])} ${Array.from({ length: 1 + Math.floor(r() * 12) }, () => pick(WORDS)).join(" ")}${pick(ENDINGS)}`);
    const text = sentences.join(pick([" ", "  ", "\n"]));
    const whole = splitForSpeech(text);
    const s = createSentenceStream();
    const out: string[] = [];
    for (let i = 1; i <= text.length; i += 1 + Math.floor(r() * 15)) out.push(...s.push(text.slice(0, i)));
    out.push(...s.push(text), ...s.flush());
    expect(out).toEqual(whole);
    expect(whole.every((p) => p.length > 0 && p === p.trim() && p.length <= MAX_SENTENCE_CHARS)).toBe(true);
    expect(normalized(whole.join(" "))).toBe(normalized(text));
  });
});
