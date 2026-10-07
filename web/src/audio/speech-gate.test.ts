import { describe, expect, it } from "vitest";
import { SpeechGate, VAD_PRESETS, type GateEvent } from "./speech-gate";

const F = 32; // ms/帧
function run(gate: SpeechGate, frames: Array<[number, number]>): GateEvent[] {
  return frames.flatMap(([p, db]) => gate.push(p, db));
}
const repeat = (n: number, frame: [number, number]) => Array.from({ length: n }, () => frame);

describe("VAD_PRESETS (plan R10 numbers)", () => {
  it("match the plan verbatim", () => {
    expect(VAD_PRESETS).toEqual({
      normal: { startProb: 0.5, endProb: 0.35, minSpeechMs: 250, redemptionMs: 600, minDbfs: -38 },
      "bot-speaking": { startProb: 0.8, endProb: 0.35, minSpeechMs: 400, redemptionMs: 600, minDbfs: -30 },
    });
  });
});

describe("SpeechGate (normal)", () => {
  it("starts after the minimum speech time and ends after the redemption time", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(8, [0.9, -20]), ...repeat(19, [0.1, -60]), ...repeat(1, [0.1, -60])]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", durationMs: 8 * F }]);
  });

  it("ignores a burst shorter than the minimum", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), [...repeat(7, [0.9, -20]), ...repeat(30, [0.1, -60])])).toEqual([]);
  });

  it("does not start on quiet speech below the energy floor (distant voices)", () => {
    expect(run(new SpeechGate(F, VAD_PRESETS.normal), repeat(40, [0.95, -45]))).toEqual([]);
  });

  it("a short pause inside speech does not end it", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(10, [0.9, -20]), ...repeat(10, [0.1, -60]), ...repeat(10, [0.9, -20])]);
    expect(events).toEqual([{ type: "speech-start" }]);
    expect(g.speaking).toBe(true);
  });

  // 等待阶段是"漏桶"计数(review F3-I1):说话帧 +1 帧,不满足的帧 −1 帧(不低于 0),累计 ≥ minSpeechMs 才开始。
  // 以前任何一帧不满足就清零,真实连读里每 2–3 个音节就有一帧闭塞/清辅音低于门限,插话几乎永远起不来;
  // 漏桶仍然让一帧坏帧付出两帧的代价(少涨一帧 + 漏掉一帧),所以稀疏的响帧凑不够。
  it("a frame below the start probability costs two frames of progress while waiting (leaky count, review F3-I1)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    // 4 好 → 4;3 帧 0.4(< startProb)→ 1;4 好 → 5 帧 = 160 ms < 250 ms
    expect(run(g, [...repeat(4, [0.9, -20]), ...repeat(3, [0.4, -20]), ...repeat(4, [0.9, -20])])).toEqual([]);
    expect(run(g, repeat(2, [0.9, -20]))).toEqual([]); // 7 帧 = 224 ms
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]); // 8 帧 = 256 ms
  });

  it("one frame below the energy floor does not restart the count: 7 speech, 1 quiet, 7 speech starts (leaky count, review F3-I1)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    // 7 → 6(漏一帧)→ 再 2 帧到 8 帧开始;旧的"清零"规则要再等满 8 帧
    expect(run(g, [...repeat(7, [0.9, -20]), [0.9, -45]])).toEqual([]);
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([]);
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
  });

  it("the leaky count never goes below zero: long silence banks nothing, and alternating good/bad frames never start", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, repeat(100, [0.1, -60]))).toEqual([]);
    expect(run(g, repeat(7, [0.9, -20]))).toEqual([]);
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]); // 恰好 8 帧,前面的静音没有"欠账"
    const h = new SpeechGate(F, VAD_PRESETS.normal);
    const alternating = Array.from({ length: 1000 }, (_, i): [number, number] => (i % 2 ? [0.1, -60] : [0.9, -20]));
    expect(run(h, alternating)).toEqual([]);
  });

  it("hysteresis once speaking: probabilities between the end and start thresholds keep speech going", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, [...repeat(8, [0.9, -20]), ...repeat(40, [0.4, -20])])).toEqual([{ type: "speech-start" }]);
    expect(g.speaking).toBe(true);
  });

  it("quiet background voices after real speech end the utterance within redemptionMs + one frame (review W2 I2)", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    expect(run(g, repeat(10, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
    const events: GateEvent[] = [];
    let frames = 0;
    while (!events.length && frames < 400) {
      events.push(...g.push(0.6, -50)); // 远处的人声/电视:概率够,能量不够
      frames++;
    }
    expect(events).toEqual([{ type: "speech-end", durationMs: 10 * F }]);
    expect(frames * F).toBeLessThanOrEqual(VAD_PRESETS.normal.redemptionMs + F);
    expect(g.speaking).toBe(false);
  });

  it("durationMs counts speech up to the last speech frame, including short pauses but not the trailing silence", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    const events = run(g, [...repeat(8, [0.9, -20]), ...repeat(5, [0.1, -60]), ...repeat(3, [0.9, -20]), ...repeat(19, [0.1, -60])]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", durationMs: 16 * F }]);
  });

  it("ends after exactly ceil(redemptionMs / frameMs) silent frames", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    run(g, repeat(8, [0.9, -20]));
    expect(run(g, repeat(18, [0.1, -60]))).toEqual([]); // 576 ms < 600 ms
    expect(run(g, repeat(1, [0.1, -60]))).toEqual([{ type: "speech-end", durationMs: 8 * F }]);
  });
});

describe("SpeechGate (bot speaking: echo protection)", () => {
  it("needs a higher probability, more energy and longer speech", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(20, [0.7, -20]))).toEqual([]); // 概率不够
    g.reset();
    expect(run(g, repeat(20, [0.9, -34]))).toEqual([]); // 能量不够(回声通常较弱)
    g.reset();
    expect(run(g, repeat(12, [0.9, -20]))).toEqual([]); // 384 ms < 400 ms
    expect(run(g, repeat(1, [0.9, -20]))).toEqual([{ type: "speech-start" }]);
  });

  it("weak echo with 10% loud frames never triggers in 60 s (review W2 I1)", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    const frames = Math.ceil(60_000 / F);
    const events: GateEvent[] = [];
    for (let i = 0; i < frames; i++) events.push(...g.push(0.9, i % 10 === 9 ? -25 : -34));
    expect(events).toEqual([]);
  });

  it("starts after ceil(400 / frameMs) net loud, confident frames; a weak frame costs two (leaky count, review F3-I1)", () => {
    const g = new SpeechGate(F, VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(12, [0.85, -25]))).toEqual([]); // 384 ms < 400 ms
    expect(run(g, [[0.79, -25], [0.85, -25]])).toEqual([]); // 0.79 < 0.8:12 → 11 → 12
    expect(run(g, repeat(1, [0.85, -25]))).toEqual([{ type: "speech-start" }]); // 13 帧 = 416 ms
  });

  it("switching presets mid-stream applies from the next frame", () => {
    const g = new SpeechGate(F, VAD_PRESETS.normal);
    run(g, repeat(4, [0.9, -20]));
    g.setPreset(VAD_PRESETS["bot-speaking"]);
    expect(run(g, repeat(4, [0.9, -20]))).toEqual([]); // 8 帧 = 256 ms < 400 ms
  });
});

// ---- 确定性模拟(review F3-I1):同一组种子每次结果相同 ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uniform = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand();
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const MINUTE_FRAMES = Math.ceil(60_000 / F);

/** 60 s 的回声/背景人声:每帧概率在 prob 区间;loudFraction 的帧能量在门限之上,其余在门限之下。返回误触发次数。 */
function falseStarts(sensitivity: "normal" | "bot-speaking", seed: number, prob: [number, number], loud: [number, number], quiet: [number, number], loudFraction: number) {
  const rand = mulberry32(seed * 7919);
  const g = new SpeechGate(F, VAD_PRESETS[sensitivity]);
  let starts = 0;
  for (let i = 0; i < MINUTE_FRAMES; i++) {
    const level = rand() < loudFraction ? uniform(rand, ...loud) : uniform(rand, ...quiet);
    for (const e of g.push(uniform(rand, ...prob), level)) {
      if (e.type === "speech-start") {
        starts++;
        g.reset(); // 计下一次误触发
      }
    }
  }
  return starts;
}

/**
 * 真实说话模型(32 ms 帧,即生产里的 Silero v5 帧长):1.5–3 s;开头两帧是 Silero 的起声爬坡(0.3, 0.6);
 * 之后每 4–7 个元音帧(≈130–220 ms,2–3 个音节)出现 1 帧闭塞/清辅音(25% 是词间 2 帧),
 * 这些帧比元音低 12±3 dB、概率 0.1–0.7;元音帧概率 0.8–0.99,能量 E±3 dB(E 每句随机)。
 * 约 18% 的帧低于门限。返回开始时刻(从第一帧起算,ms)或 null。
 */
function speechStartMs(sensitivity: "normal" | "bot-speaking", seed: number, band: [number, number]): number | null {
  const rand = mulberry32(seed);
  const E = uniform(rand, ...band);
  const n = Math.round(uniform(rand, 1500, 3000) / F);
  const frames: Array<[number, number]> = [[0.3, E], [0.6, E]];
  while (frames.length < n) {
    const vowels = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < vowels; k++) frames.push([uniform(rand, 0.8, 0.99), E + uniform(rand, -3, 3)]);
    const dips = rand() < 0.25 ? 2 : 1;
    for (let k = 0; k < dips; k++) frames.push([uniform(rand, 0.1, 0.7), E - 12 + uniform(rand, -3, 3)]);
  }
  const g = new SpeechGate(F, VAD_PRESETS[sensitivity]);
  for (let i = 0; i < n; i++) if (g.push(...frames[i]).some((e) => e.type === "speech-start")) return (i + 1) * F;
  return null;
}
const percentile = (sorted: number[], q: number) => sorted[Math.ceil(sorted.length * q) - 1];

describe("SpeechGate simulations (review F3-I1, seeded)", () => {
  it("bot speaking: echo with 10% and 25% loud frames never starts in 200 × 60 s", () => {
    for (const fraction of [0.1, 0.25]) {
      const total = SEEDS.reduce((sum, s) => sum + falseStarts("bot-speaking", s, [0.8, 0.99], [-29, -22], [-40, -31], fraction), 0);
      expect({ fraction, total }).toEqual({ fraction, total: 0 });
    }
  });

  it("normal: a background talker with 10% frames above the floor starts at most once in 200 × 60 s", () => {
    const total = SEEDS.reduce((sum, s) => sum + falseStarts("normal", s, [0.5, 0.8], [-37, -30], [-50, -39], 0.1), 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it("normal: real speech at −31…−24 dBFS starts in ≥ 95% of 200 utterances, p95 latency ≤ minSpeechMs + 200 ms", () => {
    const starts = SEEDS.map((s) => speechStartMs("normal", s, [-31, -24]));
    const latencies = starts.filter((t): t is number => t !== null).sort((a, b) => a - b);
    expect(latencies.length).toBeGreaterThanOrEqual(190);
    expect(percentile(latencies, 0.95)).toBeLessThanOrEqual(VAD_PRESETS.normal.minSpeechMs + 200);
  });

  it("bot speaking: barge-in at −28…−22 dBFS starts in ≥ 90% of 200 utterances, p95 latency ≤ minSpeechMs + 600 ms", () => {
    // 漏桶下每个坏帧要多花 2 帧:~18% 坏帧时期望 ≈ 13 / (1 − 2·0.18) ≈ 20 帧 ≈ 650 ms,
    // 所以 bot-speaking 的 minSpeechMs + 200 ms 在 32 ms 帧上做不到(normal 能做到),这里给 +600 ms。
    const starts = SEEDS.map((s) => speechStartMs("bot-speaking", s, [-28, -22]));
    const latencies = starts.filter((t): t is number => t !== null).sort((a, b) => a - b);
    expect(latencies.length).toBeGreaterThanOrEqual(180);
    expect(percentile(latencies, 0.95)).toBeLessThanOrEqual(VAD_PRESETS["bot-speaking"].minSpeechMs + 600);
  });
});
