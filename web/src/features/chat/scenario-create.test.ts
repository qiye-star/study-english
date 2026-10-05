import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { OpeningNotSavedError, discardUnfinished, runScenarioCreation, type CreationProgress } from "./scenario-create";
import { PRESET_SCENARIOS } from "./scenarios";

const CONV = { id: "c9", name: "Ordering coffee", config: { scenario: { id: "cafe" }, level: "B1" } };
const setup = (routes: Record<string, Handler>) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const body = (c: { body: BodyInit | null | undefined }) => JSON.parse(c.body as string);
const cafe = { scenario: { id: "cafe" }, level: "B1" as const, name: "Ordering coffee" };

describe("runScenarioCreation", () => {
  it("creates the conversation with only scenario + level and saves the opening as the first assistant message", async () => {
    const { api, mock } = setup({
      "POST /api/conversations": () => json(CONV),
      "POST /api/conversations/c9/messages": () => json({ messages: [{ id: "m1", role: "assistant", content: "x" }] }),
    });
    const out = await runScenarioCreation(api, cafe, {});
    expect(out).toMatchObject({ conversation: { id: "c9" }, openingId: "m1" });
    expect(body(mock.calls[0])).toEqual({ name: "Ordering coffee", config: { scenario: { id: "cafe" }, level: "B1" } });
    expect(body(mock.calls[1])).toEqual({ messages: [{ role: "assistant", content: PRESET_SCENARIOS.cafe.opening }] });
  });

  it("a free conversation has no opening line", async () => {
    const { api, mock } = setup({ "POST /api/conversations": () => json({ ...CONV, name: "New conversation" }) });
    const out = await runScenarioCreation(api, { scenario: { id: "free" }, level: "auto", name: "New conversation" }, {});
    expect(out.openingId).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });

  it("after a definite opening failure, retrying only saves the opening", async () => {
    let fail = true;
    const { api, mock } = setup({
      "POST /api/conversations": () => json(CONV),
      "POST /api/conversations/c9/messages": () => (fail ? json({ error: "Message limit reached" }, 429) : json({ messages: [{ id: "m2" }] })),
    });
    const progress: CreationProgress = {};
    await expect(runScenarioCreation(api, cafe, progress)).rejects.toBeInstanceOf(OpeningNotSavedError);
    expect(progress).toMatchObject({ conversation: { id: "c9" }, openingPending: true, ambiguous: false });
    fail = false;
    expect((await runScenarioCreation(api, cafe, progress)).openingId).toBe("m2");
    expect(mock.calls.filter((c) => c.url.pathname === "/api/conversations")).toHaveLength(1);
    expect(mock.calls.some((c) => c.method === "GET")).toBe(false);
  });

  it("after an ambiguous failure, the retry adopts an opening the server did store", async () => {
    const { api, mock } = setup({
      "POST /api/conversations": () => json(CONV),
      "POST /api/conversations/c9/messages": () => json({ error: "boom" }, 502),
      "GET /api/conversations/c9/messages": () => json({ messages: [{ id: "m7", role: "assistant", content: "Hi there" }] }),
    });
    const progress: CreationProgress = {};
    await expect(runScenarioCreation(api, cafe, progress)).rejects.toBeInstanceOf(OpeningNotSavedError);
    expect(progress.ambiguous).toBe(true);
    expect((await runScenarioCreation(api, cafe, progress)).openingId).toBe("m7");
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/messages"))).toHaveLength(1);
  });

  it("discardUnfinished deletes only a conversation whose opening is still missing, and never throws", async () => {
    const { api, mock } = setup({ "DELETE /api/conversations/c9": () => json({ error: "boom" }, 500) });
    await discardUnfinished(api, {});
    await discardUnfinished(api, { conversation: CONV as never, openingPending: false });
    expect(mock.calls).toHaveLength(0);
    await expect(discardUnfinished(api, { conversation: CONV as never, openingPending: true })).resolves.toBeUndefined();
    expect(mock.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["DELETE /api/conversations/c9"]);
  });
});
