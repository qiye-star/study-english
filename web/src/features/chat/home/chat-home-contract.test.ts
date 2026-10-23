import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import type { ConversationConfig } from "../chat-api";
import { getChatHomeConfig, getChatPrefs, postToday } from "./chat-home-api";
import { parseEmphasis, stripEmphasis } from "./emphasis";
// Stub of the server fixture (server plan 5.1). When server/tests/fixtures/chat_home_contract.json lands (task S10),
// point this import at it (the web/CLAUDE.md fixture exception) and keep the assertions.
import contract from "./chat-home-contract.stub.json";

const TODAY_CASES = ["today_ready_bilingual", "today_ready_zh", "today_ready_no_stats", "today_pending", "today_off"] as const;

function client(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
const isSnake = (k: string) => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(k);

describe("chat home contract (server plan 5.1)", () => {
  it("config and settings round-trip into ChatHomeConfig / ChatPrefs", async () => {
    const { api } = client({
      "GET /api/chat-home/config": () => json(contract.config),
      "GET /api/chat-home/settings": () => json(contract.settings),
    });
    expect(await getChatHomeConfig(api)).toEqual({ enabled: true, llm: true });
    expect(await getChatPrefs(api)).toEqual({ greetingTrigger: "daily", language: "bilingual", dailyPersonaId: "builtin:partner", includeStats: true });
  });

  it.each(TODAY_CASES)("%s parses into TodayResult", async (name) => {
    const body = contract[name];
    const { api } = client({ "POST /api/chat-home/today": () => json(body) });
    const r = await postToday(api, { tzOffsetMinutes: 480, clientRequestId: "r1" });
    expect(r.localDate).toBe(body.local_date);
    expect(r.status).toBe(body.status);
    expect(r.conversation.dailyDate).toBe(body.local_date);
    if (body.greeting === null) {
      expect(r.greeting).toBeNull();
      return;
    }
    const g = r.greeting!;
    expect(g.lines).toHaveLength(3);
    expect(g.messageIds).toHaveLength(3);
    expect(g.generatedAt).toBeTruthy();
    expect(typeof g.firstView).toBe("boolean");
  });

  it("conversation.config keys are snake_case on the wire and camelCase in the client (FR0)", async () => {
    const body = contract.today_ready_bilingual;
    for (const key of Object.keys(body.conversation.config)) expect(isSnake(key)).toBe(true);
    const { api } = client({ "POST /api/chat-home/today": () => json(body) });
    const config: ConversationConfig = (await postToday(api, { tzOffsetMinutes: 0, clientRequestId: "r" })).conversation.config;
    expect(config.agentPersonaId).toBe("builtin:partner");
    expect(config.zhNote).toBe("always");
    expect(config.bilingual).toBe(true);
  });

  it("include_stats=false leaves facts empty", async () => {
    const { api } = client({ "POST /api/chat-home/today": () => json(contract.today_ready_no_stats) });
    expect((await postToday(api, { tzOffsetMinutes: 0, clientRequestId: "r" })).greeting!.facts).toEqual({});
  });

  it("facts keep only known finite numbers (yesterday_mistakes -> yesterdayMistakes)", async () => {
    const body = { ...contract.today_ready_bilingual, greeting: { ...contract.today_ready_bilingual.greeting, facts: { streak: 3, due: "x", yesterday_mistakes: 2, secret: 1 } } };
    const { api } = client({ "POST /api/chat-home/today": () => json(body) });
    expect((await postToday(api, { tzOffsetMinutes: 0, clientRequestId: "r" })).greeting!.facts).toEqual({ streak: 3, yesterdayMistakes: 2 });
  });

  it("every line has at most 3 valid emphases and strips to text without asterisks (R17)", async () => {
    const { api } = client({ "POST /api/chat-home/today": () => json(contract.today_ready_bilingual) });
    const g = (await postToday(api, { tzOffsetMinutes: 0, clientRequestId: "r" })).greeting!;
    for (const line of g.lines) {
      for (const text of [line.en, line.zh]) {
        expect(parseEmphasis(text!).filter((p) => p.em).length).toBeLessThanOrEqual(3);
        expect(stripEmphasis(text!)).not.toContain("*");
      }
    }
    expect(g.lines.some((l) => parseEmphasis(l.en!).filter((p) => p.em).length === 3)).toBe(true);
  });

  it("a greeting with the wrong number of lines or a missing language key counts as no greeting", async () => {
    const two = { ...contract.today_ready_bilingual, greeting: { ...contract.today_ready_bilingual.greeting, lines: contract.today_ready_bilingual.greeting.lines.slice(0, 2) } };
    const missingZh = { ...contract.today_ready_bilingual, greeting: { ...contract.today_ready_bilingual.greeting, lines: contract.today_ready_bilingual.greeting.lines.map((l) => ({ en: l.en })) } };
    for (const body of [two, missingZh]) {
      const { api } = client({ "POST /api/chat-home/today": () => json(body) });
      const r = await postToday(api, { tzOffsetMinutes: 0, clientRequestId: "r" });
      expect(r.greeting).toBeNull();
      expect(r.conversation.id).toBe("c-today"); // the conversation still loads
    }
  });
});
