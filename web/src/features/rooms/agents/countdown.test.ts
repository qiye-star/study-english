import { expect, it } from "vitest";
import { secondsLeft } from "./countdown";
import { TUTOR } from "./fixtures";

it("counts down from the server's remaining time, not the client clock", () => {
  expect(secondsLeft(TUTOR, 10_000, 10_000)).toBe(42);
  expect(secondsLeft(TUTOR, 10_000, 12_100)).toBe(40);
  expect(secondsLeft(TUTOR, 10_000, 99_000)).toBe(0);
  expect(secondsLeft({ ...TUTOR, phase: "generating", remainingMs: null }, 0, 0)).toBeNull();
  expect(secondsLeft(null, 0, 0)).toBeNull();
});
