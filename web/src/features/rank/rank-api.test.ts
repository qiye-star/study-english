import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { abandonMatch, fetchAchievements, fetchRankMe, finishMatch, getMatch, RANK_SERVER_ERRORS, sendTurn, startMatch } from "./rank-api";
import { CONTRACT } from "./test-contract";

describe("rank api", () => {
  it("parses /me and passes the timezone offset", async () => {
    const mock = createFetchMock({ "GET /api/rank/me": () => json(CONTRACT.me) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const me = await fetchRankMe(api, 480);
    expect(mock.calls[0].url.search).toBe("?tz_offset_minutes=480");
    expect(me).toMatchObject({ tier: "gold", divisionRp: 120, promotion: { state: "eligible", targetTier: "platinum", attemptsLeft: 3 } });
    expect(me.stageTasks[0]).toMatchObject({ minScore: 75, complete: true });
    expect(me.newAchievements).toEqual(["streak_7"]);
  });

  it("runs the match endpoints with the contract shapes", async () => {
    const id = CONTRACT.match.id;
    const mock = createFetchMock({
      "POST /api/rank/matches": () => json({ match: CONTRACT.match }),
      [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }),
      [`POST /api/rank/matches/${id}/turns`]: () => json(CONTRACT.turn),
      [`POST /api/rank/matches/${id}/finish`]: () => json(CONTRACT.finish_pass),
      [`POST /api/rank/matches/${id}/abandon`]: () => json({ match: CONTRACT.finish_fail.match }),
      "GET /api/rank/achievements": () => json(CONTRACT.achievements),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await startMatch(api, 0)).scenario.titleZh).toBe("退换商品");
    expect(mock.calls[0].url.search).toBe("?tz_offset_minutes=0");
    expect((await getMatch(api, id)).verdict).toBeNull();
    const turn = await sendTurn(api, id, new Blob([new Uint8Array(44)], { type: "audio/wav" }));
    expect(turn).toEqual({ turnIndex: 1, transcript: CONTRACT.turn.transcript, aiLine: CONTRACT.turn.ai_line, done: false });
    expect((mock.calls[2].body as FormData).get("file")).toBeInstanceOf(Blob);
    const finished = await finishMatch(api, id);
    expect(finished.verdict).toMatchObject({ passed: true, newTier: "platinum", dimensions: { speech: 81.4 }, strengthsZh: ["能清楚说明问题"] });
    expect((await abandonMatch(api, id)).status).toBe("failed");
    expect((await fetchAchievements(api))[0]).toMatchObject({ key: "streak_3", unlockedAt: expect.any(String) });
  });

  it("maps every server error string", () => {
    expect(Object.keys(RANK_SERVER_ERRORS).sort()).toEqual([
      "Audio too long", "Audio too short", "Cooldown", "Daily match limit reached", "Expected 16 kHz mono WAV", "Grading failed",
      "Match expired", "Match in progress", "Match is not active", "Match is not finished", "No attempts left", "Not eligible",
      "Promotion matches are not available", "Upstream unavailable"]);
  });
});
