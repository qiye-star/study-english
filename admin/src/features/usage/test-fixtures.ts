import type { UsageSummary } from "./api";

/** 测试用的用量汇总(3 个功能 × 7 天)。 */
export function summaryFixture({ costComplete = true }: { costComplete?: boolean } = {}): UsageSummary {
  const days = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  return {
    days: 7,
    currency: "CNY",
    totals: { calls: 1234, errors: 12, errorRate: 12 / 1234, cost: 12.48, costComplete, p50Ms: 420, p95Ms: 2100, activeUsers: 37 },
    byFeature: [
      { feature: "chat", calls: 800, errors: 8, cost: 9.1 },
      { feature: "audio", calls: 300, errors: 3, cost: 3.38 },
      { feature: "rooms", calls: 134, errors: 1, cost: costComplete ? 0 : null },
    ],
    byModel: [{ kind: "llm", provider: "deepseek", model: "deepseek-v4-flash", unit: "tokens", calls: 934, unitsIn: 120000, unitsOut: 40000, cost: 9.1 }],
    daily: days.map((day, i) => ({ day, calls: 100 + i, errors: 1, cost: 1.5, features: { chat: 60 + i, audio: 30, rooms: 10 } })),
    errors: { "402": 2, "429": 5, auth: 0, "5xx": 3, network: 2 },
  };
}
