/** 会话难度(设计文档 §3.7,计划裁定 R11)。提示词是固定英文,便于测试与复现。 */
export const LEVELS = ["auto", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

export function normalizeLevel(value: unknown): Level {
  return (LEVELS as readonly unknown[]).includes(value) ? (value as Level) : "auto";
}

export const LEVEL_INSTRUCTIONS: Record<Exclude<Level, "auto">, string> = {
  A2: "Language level: the learner is at CEFR A2. Use only very common everyday words and short, simple sentences of about 10 words or fewer. Avoid idioms and phrasal verbs. If you must use a less common word, explain it right away in very simple English.",
  B1: "Language level: the learner is at CEFR B1. Use common everyday vocabulary and clear sentences of about 15 words or fewer. Use idioms rarely. If you use a less common word, briefly explain it in simple words.",
  B2: "Language level: the learner is at CEFR B2. Use natural everyday English with some less common words, in sentences of about 20 words or fewer. Use idioms only occasionally and briefly explain any rare word or idiom.",
  C1: "Language level: the learner is at CEFR C1. Speak naturally, as you would with a fluent speaker. Idioms and advanced vocabulary are fine, but keep replies clear and concise, and briefly explain very rare words.",
};

export function levelInstruction(level: Level): string {
  return level === "auto" ? "" : LEVEL_INSTRUCTIONS[level];
}

export function levelHint(level: Level, purpose: "hints" | "recap"): string {
  if (level === "auto") return "";
  return purpose === "hints"
    ? `The learner is at CEFR ${level} level: write the three replies at that level.`
    : `The learner is at CEFR ${level} level: choose new expressions at or slightly above that level.`;
}
