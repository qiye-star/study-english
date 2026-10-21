import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "~/api/client";
import {
  createTake, deleteTake, type DubbingTake, fetchDubbingConfig, finishTake, getRoles, getTake, isAiLimited, isAiUnavailable, isDubbingNotFound, listTakes,
  postLine, putRoles, suggestRoles,
} from "./dubbing-api";

const ITEM = "11111111-1111-4111-8111-111111111111";
const DUB = "22222222-2222-4222-8222-222222222222";

/** 假客户端:只记录方法、路径与选项,回包由每个用例指定(客户端已把键驼峰化)。 */
function fake(reply: unknown = {}, fail?: ApiError) {
  const request = vi.fn(async () => {
    if (fail) throw fail;
    return reply;
  });
  return { client: { request } as unknown as ApiClient, request };
}

describe("dubbing-api routes and bodies", () => {
  it("config is GET /api/dubbing/config; a 404 means the feature is off, other errors throw", async () => {
    const ok = fake({ enabled: true, suggest: false, limits: null });
    expect(await fetchDubbingConfig(ok.client)).toEqual({ enabled: true, suggest: false, limits: null });
    expect(ok.request).toHaveBeenCalledWith("GET", "/api/dubbing/config");

    expect(await fetchDubbingConfig(fake({}, new ApiError(404, "Not Found")).client)).toEqual({ enabled: false, suggest: false, limits: null });
    await expect(fetchDubbingConfig(fake({}, new ApiError(500, "boom")).client)).rejects.toThrow("boom");
  });

  it("roles: GET reads, PUT sends names and speakers as one JSON body", async () => {
    const get = fake({ names: [], speakers: [], editable: true, locked: null });
    await getRoles(get.client, ITEM);
    expect(get.request).toHaveBeenCalledWith("GET", `/api/dubbing/items/${ITEM}/roles`, expect.anything());

    const put = fake({ names: [{ key: "A", name: "Host" }], speakers: [{ idx: 0, speaker: "B" }], editable: true, locked: null });
    const out = await putRoles(put.client, ITEM, { names: { A: "Host" }, speakers: [{ idx: 0, speaker: "B" }] });
    expect(put.request).toHaveBeenCalledWith("PUT", `/api/dubbing/items/${ITEM}/roles`, {
      json: { names: { A: "Host" }, speakers: [{ idx: 0, speaker: "B" }] },
    });
    expect(out.names).toEqual([{ key: "A", name: "Host" }]);
  });

  it("suggest is a POST of one clip and returns only the draft speakers", async () => {
    const f = fake({ speakers: [{ idx: 0, speaker: "A" }] });
    const out = await suggestRoles(f.client, ITEM, { segFrom: 0, segTo: 3 });
    expect(f.request).toHaveBeenCalledWith("POST", `/api/dubbing/items/${ITEM}/roles/suggest`, { json: { segFrom: 0, segTo: 3 } });
    expect(out).toEqual({ speakers: [{ idx: 0, speaker: "A" }] });
  });

  it("takes: create unwraps {take}; list unwraps {takes}; get, delete and finish use the take id", async () => {
    const take: DubbingTake = {
      id: DUB, itemId: ITEM, segFrom: 0, segTo: 2, role: "A", status: "recording", expected: [0, 2], totalScore: null, summary: null, lines: [],
      createdAt: "t", finishedAt: null,
    };
    const create = fake({ take });
    expect(await createTake(create.client, ITEM, { segFrom: 0, segTo: 2, role: "A" })).toEqual(take);
    expect(create.request).toHaveBeenCalledWith("POST", `/api/dubbing/items/${ITEM}/takes`, { json: { segFrom: 0, segTo: 2, role: "A" } });

    const list = fake({ takes: [take] });
    expect(await listTakes(list.client, ITEM)).toEqual([take]);
    expect(list.request).toHaveBeenCalledWith("GET", `/api/dubbing/items/${ITEM}/takes`, expect.anything());

    const get = fake({ take });
    expect(await getTake(get.client, DUB)).toEqual(take);
    expect(get.request).toHaveBeenCalledWith("GET", `/api/dubbing/takes/${DUB}`, expect.anything());

    const del = fake({});
    await deleteTake(del.client, DUB);
    expect(del.request).toHaveBeenCalledWith("DELETE", `/api/dubbing/takes/${DUB}`);

    const fin = fake({ take: { ...take, status: "done" } });
    expect((await finishTake(fin.client, DUB)).status).toBe("done");
    expect(fin.request).toHaveBeenCalledWith("POST", `/api/dubbing/takes/${DUB}/finish`);
  });

  it("a line posts one assessment reference and unwraps {line}", async () => {
    const f = fake({ line: { segIdx: 0, pronunciation: 90, fluency: 80, sync: 70, syncBasis: "words", score: 84 } });
    const out = await postLine(f.client, DUB, { segIdx: 0, assessmentId: "a1", recStartMs: 1200, voicedMs: 900, capture: "pcm" });
    expect(f.request).toHaveBeenCalledWith("POST", `/api/dubbing/takes/${DUB}/lines`, {
      json: { segIdx: 0, assessmentId: "a1", recStartMs: 1200, voicedMs: 900, capture: "pcm" },
    });
    expect(out.score).toBe(84);
  });
});

describe("dubbing-api error classification is by status, not by text", () => {
  it("404 is not-found, 429 is a limit, 503 is an unavailable AI", () => {
    expect(isDubbingNotFound(new ApiError(404, "anything"))).toBe(true);
    expect(isDubbingNotFound(new ApiError(409, "Item is not ready"))).toBe(false);
    expect(isAiLimited(new ApiError(429, "AI is busy today"))).toBe(true);
    expect(isAiLimited(new ApiError(503, "x"))).toBe(false);
    expect(isAiUnavailable(new ApiError(503, "AI is unavailable"))).toBe(true);
    expect(isAiUnavailable(new Error("network"))).toBe(false);
  });
});
