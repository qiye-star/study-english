import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { dormantPromptHint, localOffsetMinutes } from "./register";

function clientFor(body: unknown, status = 200) {
  const mock = createFetchMock({ "GET /api/activation/prompt-hint": () => json(body, status) });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

describe("dormant prompt hint (plan L4 Task 16)", () => {
  it("returns the server's instruction and asks for the local offset", async () => {
    const { api, mock } = clientFor({ words: ["talk"], block: "Words the learner knows but has not used yet: talk." });
    const block = await dormantPromptHint(api, new AbortController().signal);
    expect(block).toBe("Words the learner knows but has not used yet: talk.");
    expect(mock.calls[0].url.searchParams.has("offset")).toBe(true);
    expect([...mock.calls[0].url.searchParams.keys()]).toEqual(["offset"]);
  });

  it("answers nothing when there is no qualifying word", async () => {
    const { api } = clientFor({ words: [], block: null });
    expect(await dormantPromptHint(api, new AbortController().signal)).toBeNull();
  });

  it("answers nothing when the switch is off (the server returns 404)", async () => {
    const { api } = clientFor({ error: "Activation is off" }, 404);
    await expect(dormantPromptHint(api, new AbortController().signal)).rejects.toBeTruthy();
  });

  it("reports the offset the way the server expects it (east of UTC is positive)", () => {
    expect(localOffsetMinutes({ getTimezoneOffset: () => -480 } as unknown as Date)).toBe(480);
    expect(localOffsetMinutes({ getTimezoneOffset: () => 300 } as unknown as Date)).toBe(-300);
  });
});
