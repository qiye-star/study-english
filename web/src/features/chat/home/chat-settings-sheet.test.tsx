import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetAgentsCaches } from "~/features/agents/use-agents-data";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { Conversation } from "../chat-api";
import type { ChromeCtl } from "../conversation-chrome";
import contract from "./chat-home-contract.stub.json";
import { ChatSettingsSheet } from "./chat-settings-sheet";
import { getChatHomeState, requestToday, resetChatHomeStore } from "./chat-home-store";
import { resetChatPrefsCache } from "./use-chat-prefs";

const persona = (id: string, name: string) => ({
  id, builtin: true, mine: false, name, intro: `${name} intro`, prompt: null as string | null, level: "B1", style: "friendly",
  voice: null as string | null, tools: [] as string[], prompt_public: true, deep_think: false, disabled: false, created_at: null as string | null, updated_at: null as string | null,
});
const AGENTS_ON = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 }, levels: ["B1"], styles: ["friendly"], tools: [] as string[] };
const PREFS = { greeting_trigger: "daily", language: "bilingual", daily_persona_id: "builtin:partner", include_stats: true };

function makeCtl(over: Partial<ChromeCtl> = {}, convId = "c-today"): ChromeCtl {
  const conversation = { id: convId, name: "x", config: { agentPersonaId: "builtin:partner" }, createdAt: "", updatedAt: "" } as unknown as Conversation;
  return {
    conversation, config: conversation.config, options: {} as ChromeCtl["options"], personaName: "Partner",
    saveSettings: vi.fn(() => Promise.resolve()),
    toggles: { canTranslate: true, bilingual: false, autoSpeak: true, loaded: true, bilingualSaving: false, autoSpeakSaving: false },
    toggleBilingual: vi.fn(), toggleAutoSpeak: vi.fn(), openSettings: vi.fn(), openRecap: vi.fn(), startCall: vi.fn(),
    callState: { canCall: false, callDisabled: false, callButtonRef: { current: null } },
    choosePersona: vi.fn(), reportPersona: vi.fn(), reportAgentsOff: vi.fn(),
    busy: { sending: false, voiceBusy: false, call: false, settling: false, tutor: false, any: false },
    ...over,
  };
}

function Harness({ ctl, onReplay }: { ctl: ChromeCtl; onReplay?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p data-testid="open-state">{open ? "open" : "closed"}</p>
      <ChatSettingsSheet open={open} onOpenChange={setOpen} ctl={ctl} onReplay={onReplay} />
    </>
  );
}

async function setup(ctl = makeCtl(), extra: Record<string, Handler> = {}, opts: { seedToday?: boolean; onReplay?: () => void } = {}) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(AGENTS_ON),
    "GET /api/agents/personas": () => json({ personas: [persona("builtin:partner", "Partner"), persona("builtin:coach", "Emma")] }),
    "GET /api/chat-home/settings": () => json(PREFS),
    "PATCH /api/chat-home/settings": (c) => json({ ...PREFS, ...JSON.parse(String(c.body)) }),
    "POST /api/chat-home/today": () => json(contract.today_ready_bilingual),
    ...extra,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  if (opts.seedToday !== false) await requestToday(api, { open: true });
  mock.calls.length = 0;
  renderWithProviders(<Harness ctl={ctl} onReplay={opts.onReplay} />, { api, route: "/chat" });
  await screen.findByTestId("chat-settings-sheet");
  await screen.findByTestId("chat-greeting-lang-bilingual");
  return { mock, ctl };
}
const patches = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "PATCH").map((c) => ({ path: c.url.pathname, body: JSON.parse(String(c.body)) }));

// the full suite runs these on a loaded machine: give async queries more than the 1 s default
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => { resetAgentsCaches(); resetChatHomeStore(); resetChatPrefsCache(); });
afterEach(() => { resetChatHomeStore(); resetChatPrefsCache(); });

describe("chat settings sheet", () => {
  it("picking a persona hands it to the page's choosePersona", async () => {
    const { ctl } = await setup();
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:coach"));
    expect(ctl.choosePersona).toHaveBeenCalledWith(expect.objectContaining({ id: "builtin:coach" }));
  });

  it("disables the persona list while the page is busy (guided lesson, sending, call)", async () => {
    await setup(makeCtl({ busy: { sending: false, voiceBusy: false, call: false, settling: false, tutor: true, any: true } }));
    expect(await screen.findByTestId("agent-persona-builtin:coach")).toBeDisabled();
  });

  it("has no persona section when agents are off", async () => {
    await setup(makeCtl(), { "GET /api/agents/config": () => json({ ...AGENTS_ON, enabled: false }) });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("agent-persona-radio-list")).toBeNull();
    expect(screen.queryByTestId("chat-daily-persona")).toBeNull();
    expect(screen.getByTestId("chat-greeting-stats")).toBeInTheDocument();
  });

  it("the daily-persona switch writes daily_persona_id (today's chat only)", async () => {
    const { mock } = await setup(makeCtl({}, "c-today"));
    const sw = await screen.findByTestId("chat-daily-persona");
    expect(sw).toHaveAttribute("role", "switch");
    expect(sw).toHaveAttribute("aria-checked", "true"); // prefs persona = this chat's persona
    await userEvent.click(sw);
    await waitFor(() => expect(patches(mock)).toEqual([{ path: "/api/chat-home/settings", body: { daily_persona_id: "builtin:partner" } }]));
  });

  it("no daily-persona switch outside today's chat", async () => {
    await setup(makeCtl({}, "c-other"));
    await screen.findByTestId("agent-persona-builtin:coach");
    expect(screen.queryByTestId("chat-daily-persona")).toBeNull();
  });

  it("changing the greeting language to Chinese patches /settings and today's chat hints (zh_note always)", async () => {
    const { mock, ctl } = await setup();
    await userEvent.click(screen.getByTestId("chat-greeting-lang-zh"));
    await waitFor(() => expect(ctl.saveSettings).toHaveBeenCalledWith({ zhNote: "always", bilingual: false }));
    expect(patches(mock)).toEqual([{ path: "/api/chat-home/settings", body: { language: "zh" } }]);
  });

  it("bilingual writes always + bilingual=true; English clears the hint", async () => {
    const { ctl } = await setup(undefined, { "GET /api/chat-home/settings": () => json({ ...PREFS, language: "zh" }) });
    await userEvent.click(screen.getByTestId("chat-greeting-lang-bilingual"));
    await waitFor(() => expect(ctl.saveSettings).toHaveBeenCalledWith({ zhNote: "always", bilingual: true }));
    await userEvent.click(screen.getByTestId("chat-greeting-lang-en"));
    await waitFor(() => expect(ctl.saveSettings).toHaveBeenLastCalledWith({ zhNote: undefined, bilingual: false }));
  });

  it("in another chat the language only goes to /settings", async () => {
    const { mock, ctl } = await setup(makeCtl({}, "c-other"));
    await userEvent.click(screen.getByTestId("chat-greeting-lang-zh"));
    await waitFor(() => expect(patches(mock)).toHaveLength(1));
    expect(ctl.saveSettings).not.toHaveBeenCalled();
  });

  it("the trigger segment patches greeting_trigger, shows its hint, and arrow keys switch", async () => {
    const { mock } = await setup();
    await userEvent.click(screen.getByTestId("chat-greeting-trigger-every_open"));
    await waitFor(() => expect(patches(mock)).toEqual([{ path: "/api/chat-home/settings", body: { greeting_trigger: "every_open" } }]));
    expect(await screen.findByText(/chat is not repeated/)).toBeInTheDocument();
    screen.getByTestId("chat-greeting-trigger-every_open").focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(patches(mock).at(-1)?.body).toEqual({ greeting_trigger: "off" }));
    expect(screen.getByRole("radiogroup", { name: "When to greet" })).toBeInTheDocument();
  });

  it("every segment option is a 44 px target (hit-expand) and the done button is 44 px", async () => {
    await setup();
    expect(screen.getByTestId("chat-greeting-lang-zh").className).toContain("hit-expand");
    expect(screen.getByTestId("chat-settings-done").className).toContain("h-11");
  });

  it("the stats switch patches include_stats, empties today's facts, and rolls back on failure", async () => {
    const { mock } = await setup();
    const sw = screen.getByTestId("chat-greeting-stats");
    expect(sw).toHaveAttribute("role", "switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(getChatHomeState().today?.greeting?.facts.streak).toBe(23);
    await userEvent.click(sw);
    await waitFor(() => expect(getChatHomeState().today?.greeting?.facts).toEqual({}));
    expect(patches(mock)).toEqual([{ path: "/api/chat-home/settings", body: { include_stats: false } }]);
    expect(screen.getByTestId("chat-greeting-stats")).toHaveAttribute("aria-checked", "false");
  });

  it("a failed include_stats save restores the switch, keeps the facts and tells the user", async () => {
    await setup(makeCtl(), { "PATCH /api/chat-home/settings": () => json({ error: "invalid", field: "include_stats" }, 422) });
    await userEvent.click(screen.getByTestId("chat-greeting-stats"));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByTestId("chat-greeting-stats")).toHaveAttribute("aria-checked", "true");
    expect(getChatHomeState().today?.greeting?.facts.streak).toBe(23);
  });

  it("keeps the three per-chat rows with their testids and wires recap / more settings", async () => {
    const { ctl } = await setup();
    expect(screen.getByTestId("conversation-bilingual")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-autospeak")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("conversation-speed")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-autospeak"));
    expect(ctl.toggleAutoSpeak).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("conversation-recap"));
    expect(ctl.openRecap).toHaveBeenCalled();
    expect(screen.getByTestId("open-state")).toHaveTextContent("closed");
  });

  it("more settings closes the sheet and opens the original conversation settings", async () => {
    const { ctl } = await setup();
    await userEvent.click(screen.getByTestId("conversation-settings"));
    expect(ctl.openSettings).toHaveBeenCalled();
    expect(screen.getByTestId("open-state")).toHaveTextContent("closed");
  });

  it("replay shows only for today's chat with a ready greeting, makes no request and calls onReplay after closing", async () => {
    const onReplay = vi.fn();
    const { mock } = await setup(undefined, {}, { onReplay });
    await userEvent.click(screen.getByTestId("chat-greeting-replay"));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("open-state")).toHaveTextContent("closed");
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("no replay row in another chat, with the greeting off, or without a stored greeting", async () => {
    await setup(makeCtl({}, "c-other"), {}, { onReplay: vi.fn() });
    expect(screen.queryByTestId("chat-greeting-replay")).toBeNull();
  });

  it("no replay row when today has no ready greeting (status off)", async () => {
    await setup(undefined, { "POST /api/chat-home/today": () => json(contract.today_off) }, { onReplay: vi.fn() });
    expect(screen.queryByTestId("chat-greeting-replay")).toBeNull();
  });

  it("a failing /settings only affects the two global sections", async () => {
    await setup(undefined, { "GET /api/chat-home/settings": () => json({ error: "x" }, 500) });
    expect(await screen.findByText(/Could not load the greeting settings/)).toBeInTheDocument();
    expect(screen.getByTestId("chat-greeting-lang-zh")).toBeDisabled();
    expect(screen.getByTestId("conversation-autospeak")).toBeEnabled();
    expect(screen.getByTestId("conversation-recap")).toBeEnabled();
  });

  it("'more personas' closes the sheet and opens the original picker (no nested sheets)", async () => {
    await setup();
    await userEvent.click(await screen.findByTestId("agent-persona-more"));
    expect(screen.getByTestId("open-state")).toHaveTextContent("closed");
    const picker = await screen.findByTestId("agent-persona-picker");
    expect(within(picker).getByTestId("agent-persona-none")).toBeInTheDocument();
  });
});
