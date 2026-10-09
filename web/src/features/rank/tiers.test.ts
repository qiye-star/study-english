import { describe, expect, it } from "vitest";
import { divisionLabel, formatCountdown, pointsToGate, progressRatio, TIER_ICONS, TIER_KEYS, userTurns } from "./tiers";

describe("tiers", () => {
  it("knows the seven tiers and their icons", () => {
    expect(TIER_KEYS).toEqual(["bronze", "silver", "gold", "platinum", "diamond", "star", "master"]);
    expect(Object.keys(TIER_ICONS)).toHaveLength(7);
  });

  it("labels divisions and measures progress", () => {
    expect([divisionLabel(3), divisionLabel(2), divisionLabel(1), divisionLabel(0)]).toEqual(["III", "II", "I", ""]);
    expect(progressRatio({ rp: 30, divisionRp: 120 })).toBe(0.25);
    expect(progressRatio({ rp: 999, divisionRp: 120 })).toBe(1);
    expect(pointsToGate({ tier: "gold", division: 3, rp: 30, divisionRp: 120 })).toBe(330);
    expect(pointsToGate({ tier: "gold", division: 1, rp: 120, divisionRp: 120 })).toBe(0);
    expect(pointsToGate({ tier: "master", division: 0, rp: 20, divisionRp: 200 })).toBe(0);
  });

  it("counts user turns and formats countdowns", () => {
    expect(userTurns({ turns: [{ role: "ai", text: "a" }, { role: "user", text: "b" }, { role: "ai", text: "c" }] })).toBe(1);
    expect([formatCountdown(65_000), formatCountdown(3_600_000 + 5_000), formatCountdown(-1)]).toEqual(["1:05", "60:05", "0:00"]);
  });
});
