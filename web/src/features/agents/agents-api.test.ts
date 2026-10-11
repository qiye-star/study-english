import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { agentsApi, normalizeConfig, personaErrorKey } from "./agents-api";
import { TOOL_KEYS, type PersonaDraft } from "./types";

const DRAFT: PersonaDraft = {
  name: "Quiz", intro: "Friday quiz", prompt: "Ask me five questions.", level: "B1", style: "strict",
  voice: null, tools: [...TOOL_KEYS], promptPublic: true, deepThink: false,
};

describe("agentsApi (spec §4.5)", () => {
  it("sends persona drafts and settings patches as snake_case, ids encoded in the path, nothing in the query", async () => {
    const mock = createFetchMock({
      "POST /api/agents/personas": () => json({ id: "p1", builtin: false, mine: true, ...DRAFT, prompt_public: true, deep_think: false, disabled: false, created_at: null, updated_at: null }),
      "PATCH /api/agents/personas/p%2F1": () => json({ id: "p/1" }),
      "PATCH /api/agents/settings": () => json({ show_process: false }),
      "POST /api/agents/personas/try": () => json({ text: "Hi, I am Quiz." }),
      "POST /api/agents/personas/builtin%3Acoach/report": () => json({ ok: true }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const created = await agentsApi.createPersona(api, DRAFT);
    expect(created.promptPublic).toBe(true);
    await agentsApi.updatePersona(api, "p/1", { promptPublic: false });
    await agentsApi.patchSettings(api, { showProcess: false, tools: { learnedWords: false } });
    expect((await agentsApi.tryPersona(api, DRAFT, "Hello")).text).toBe("Hi, I am Quiz.");
    await agentsApi.reportPersona(api, "builtin:coach", { reason: "spam" });
    const bodies = mock.calls.map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ prompt_public: true, deep_think: false, tools: ["lookup", "learned_words", "weak_words", "due_words", "memory"] });
    expect(bodies[1]).toEqual({ prompt_public: false });
    expect(bodies[2]).toEqual({ show_process: false, tools: { learned_words: false } });
    expect(bodies[3]).toMatchObject({ text: "Hello", persona: { name: "Quiz", prompt_public: true } });
    expect(bodies[4]).toEqual({ reason: "spam" });
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("flattens the config and treats {enabled:false} as off", async () => {
    const mock = createFetchMock({
      "GET /api/agents/config": () => json({
        enabled: true, available: true, tutor: true, memory: false, rooms: true, tools_mode: "prefetch",
        limits: { personas_max: 7, prompt_max_chars: 500, history_max: 20, text_max_chars: 2000 },
      }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await agentsApi.config(api)).toEqual({
      enabled: true, available: true, tutorEnabled: true, memoryEnabled: false, roomsEnabled: true,
      promptMaxChars: 500, personasMax: 7, historyMax: 20, textMaxChars: 2000,
    });
    expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
  });

  it("maps persona write errors by status, never by server wording", () => {
    expect(personaErrorKey(new ApiError(409, "anything"))).toBe("web.agents.editor.errors.limit");
    expect(personaErrorKey(new ApiError(429, "anything"))).toBe("web.agents.editor.errors.limit");
    expect(personaErrorKey(new ApiError(422, "anything"))).toBe("web.agents.editor.errors.invalid");
    expect(personaErrorKey(new ApiError(403, "anything"))).toBe("web.agents.errors.disabled");
    expect(personaErrorKey(new ApiError(0, "Network error"))).toBe("web.agents.editor.errors.failed");
    expect(personaErrorKey(new Error("x"))).toBe("web.agents.editor.errors.failed");
  });
});
