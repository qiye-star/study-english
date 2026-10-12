import { describe, expect, it } from "vitest";
import { applyMention, mentionOptions, mentionQuery, type MentionAgent } from "./mention-suggest";

const AGENTS: MentionAgent[] = [{ id: "builtin:coach", name: "Emma" }, { id: "u1", name: "Leo" }, { id: "u2", name: "Lena", disabled: true }];

describe("mentionQuery (only a leading @word, like the server's matcher)", () => {
  it.each([
    ["@", 1, ""], ["@Em", 3, "Em"], ["  @le", 5, "le"], ["＠e", 2, "e"], ["@助", 2, "助"],
    ["hi @Em", 6, null], ["@Emma ", 6, null], ["@Emma hi", 3, "Em"], ["", 0, null], ["@@", 2, null],
  ])("%j at %i → %j", (value, caret, expected) => {
    expect(mentionQuery(value as string, caret as number)).toBe(expected);
  });
});

describe("mentionOptions", () => {
  it("lists the AI alias first, then enabled agents by name prefix (case-insensitive)", () => {
    expect(mentionOptions(AGENTS, "", "AI(Emma)").map((o) => o.label)).toEqual(["AI(Emma)", "Emma", "Leo"]);
    expect(mentionOptions(AGENTS, "le", "AI(Emma)").map((o) => o.label)).toEqual(["Leo"]);
    expect(mentionOptions(AGENTS, "A", "AI(Emma)").map((o) => o.key)).toEqual(["alias"]);
    expect(mentionOptions(AGENTS, "助", "AI(Emma)").map((o) => o.key)).toEqual(["alias"]);
    expect(mentionOptions(AGENTS, "x", "AI")).toEqual([]);
  });

  it("inserts @AI for the alias and @Name for an agent, with a trailing space", () => {
    const [alias, emma] = mentionOptions(AGENTS, "", "AI(Emma)");
    expect([alias.insert, alias.personaId]).toEqual(["@AI ", null]);
    expect([emma.insert, emma.personaId]).toEqual(["@Emma ", "builtin:coach"]);
  });

  it("offers only the alias when no agent is configured", () => {
    expect(mentionOptions([], "", "AI").map((o) => o.key)).toEqual(["alias"]);
  });
});

describe("applyMention", () => {
  const emma = mentionOptions(AGENTS, "", "AI")[1];
  it("replaces the leading token (full-width ＠ too) and keeps the rest of the message", () => {
    expect(applyMention("@Em", 3, emma)).toEqual({ value: "@Emma ", caret: 6 });
    expect(applyMention("＠e can you help", 2, emma)).toEqual({ value: "@Emma can you help", caret: 6 });
    expect(applyMention("  @Emxx  tail", 5, emma)).toEqual({ value: "@Emma tail", caret: 6 });
  });
});
