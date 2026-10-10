import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { GOALS_CONFIG, GOALS_ENROLLMENT, GOALS_PLAN } from "./goals-test-fixtures";
import { CONFIG } from "./test-fixtures";
import {
  DEFAULT_LIMITS, WORDBOOK_SERVER_ERRORS, grantBonus, limitsOf, patchEnrollment, pauseEnrollment, resetProgress, resumeEnrollment,
  saveEnrollment, type WordbookConfig,
} from "./wordbook-api";

describe("goals API (plan 2026-10-11 GW2)", () => {
  it("sends snake_case bodies to the goals endpoints", async () => {
    const mock = createFetchMock({
      "PATCH /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT),
      "POST /api/wordbook/bonus": () => json({ plan: GOALS_PLAN, bonus_left: 40 }),
      "POST /api/wordbook/enrollment/pause": () => json({ ...GOALS_ENROLLMENT, status: "paused" }),
      "POST /api/wordbook/enrollment/resume": () => json(GOALS_ENROLLMENT),
      "POST /api/wordbook/enrollment/reset": () => json({ removed: 860, enrollment: GOALS_ENROLLMENT }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await patchEnrollment(api, { dailyNew: 35, reviewUnlimited: true })).reviewUnlimited).toBe(false);
    expect((await grantBonus(api, 10)).bonusLeft).toBe(40);
    expect((await pauseEnrollment(api)).status).toBe("paused");
    await resumeEnrollment(api, "cet4");
    expect((await resetProgress(api, "cet4", "四级")).removed).toBe(860);
    const bodies = mock.calls.map((c) => [c.method, c.url.pathname, JSON.parse(String(c.body))] as const);
    expect(bodies[0]).toEqual(["PATCH", "/api/wordbook/enrollment", { daily_new: 35, review_unlimited: true }]);
    expect(bodies[1][2]).toMatchObject({ size: 10 });
    expect(typeof bodies[1][2].tz_offset_minutes).toBe("number");
    expect(bodies[2][2]).toEqual({});
    expect(bodies[3][2]).toEqual({ book_id: "cet4" });
    expect(bodies[4][2]).toMatchObject({ book_id: "cet4", confirm: "四级" });
    expect(typeof bodies[4][2].tz_offset_minutes).toBe("number");
  });

  it("picks a book with unlimited reviews", async () => {
    const mock = createFetchMock({ "PUT /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await saveEnrollment(api, { bookId: "cet4", dailyNew: 50, reviewUnlimited: true });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ book_id: "cet4", daily_new: 50, review_unlimited: true });
  });

  it("falls back to the hard limits for an older server", () => {
    expect(limitsOf(camelcaseKeys(CONFIG, { deep: true }) as unknown as WordbookConfig)).toEqual(DEFAULT_LIMITS);
    expect(limitsOf(camelcaseKeys(GOALS_CONFIG, { deep: true }) as unknown as WordbookConfig).bonusMax).toBe(50);
    expect(limitsOf({ enabled: false })).toEqual(DEFAULT_LIMITS);
    expect(limitsOf(null)).toEqual(DEFAULT_LIMITS);
  });

  it("maps the new server errors to goals copy", () => {
    expect(WORDBOOK_SERVER_ERRORS["Daily bonus limit reached"]).toBe("web.wordbook.goals.errors.bonusLimit");
    expect(WORDBOOK_SERVER_ERRORS["Confirmation does not match"]).toBe("web.wordbook.goals.errors.confirmMismatch");
    expect(WORDBOOK_SERVER_ERRORS["Too many settings changes today"]).toBe("web.wordbook.goals.errors.settingsLimit");
    // A 的那一条仍在(INDEX §4:B 追加,不替换)
    expect(WORDBOOK_SERVER_ERRORS["Rating is required"]).toBe("web.wordbook.recall.errors.ratingRequired");
    expect(Object.values(WORDBOOK_SERVER_ERRORS).filter((k) => k.startsWith("web.wordbook.goals.errors."))).toHaveLength(13);
  });
});
