import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { AgentsPage } from "./agents-page";
import { S } from "./strings";

const days = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"];
const overview = {
  switches: { enabled: true, tutor: true, memory: true, rooms: false },
  available: true,
  tools_mode: { configured: "native", effective: "prefetch", probe: null },
  limits: { turns_global_daily: 3000, turns_daily_per_user: 300, tutor_daily_per_user: 20, memory_extract_daily_per_user: 100, personas_max: 10 },
  usage: { days, turns: [0, 0, 0, 0, 0, 3, 12], tutor: [0, 0, 0, 0, 0, 0, 2], memory: [0, 0, 0, 0, 0, 1, 4],
    today: { turns: 12, calls: 14, errors: 1, tokens_in: 900, tokens_out: 300 } },
  personas: { total: 2, disabled: 1, reports_open: 1 },
  users_with_settings: 5,
};
const persona = {
  id: "11111111-1111-4111-8111-111111111111", owner_id: 10000001, owner: "alice", name: "Tom", intro: "A cat",
  prompt: "You are Tom the cat.", level: "B1", style: "friendly", tools: ["lookup"], prompt_public: true,
  deep_think: false, disabled: false, disabled_at: null, created_at: "2026-10-12T08:00:00+00:00",
  updated_at: "2026-10-12T08:00:00+00:00", reports_open: 1,
};
const reports = { reports: [{ persona_id: persona.id, name: "Tom", owner: "alice", count: 2, reasons: { offensive: 1, spam: 1 },
  first_at: "2026-10-12T08:00:00+00:00", last_at: "2026-10-12T09:00:00+00:00", disabled: false }] };

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    let out: unknown = overview;
    if (url.includes("/probe-tools")) out = { ok: true, code: "ok", status: 200, ms: 120, at: "2026-10-12T09:00:00+00:00", model: "m" };
    else if (url.includes("/personas/query")) out = { items: [persona], page: 1, next: null };
    else if (url.includes("/resolve")) out = { persona_id: persona.id, resolved: 2, action: "dismiss" };
    else if (url.includes("/reports")) out = reports;
    else if (url.includes("/personas/")) out = { ok: true };
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}

const renderPage = () => render(<MemoryRouter><AgentsPage /></MemoryRouter>);
const body = (c: { init?: RequestInit }) => JSON.parse(String(c.init?.body));

beforeEach(() => signIn("operator"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

describe("AgentsPage", () => {
  it("shows switches, the tools fallback, numbers, personas and reports", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText(`${S.switches.enabled} · ${S.on}`)).toBeTruthy();
    expect(screen.getByText(`${S.switches.rooms} · ${S.off}`)).toBeTruthy();
    expect(screen.getByText(S.tools.mode("native", "prefetch"))).toBeTruthy();
    expect(screen.getByText(S.tools.noProbe)).toBeTruthy();
    expect(screen.getByTestId("agents-kpi-turns").textContent).toContain("12");
    const row = await screen.findByTestId(`agents-persona-${persona.id}`);
    expect(within(row).getByText("Tom")).toBeTruthy();
    expect(within(row).getByText("alice")).toBeTruthy();
    const report = screen.getByTestId(`agents-report-${persona.id}`);
    expect(within(report).getByText(`${S.reasons.offensive} 1 · ${S.reasons.spam} 1`)).toBeTruthy();
  });

  it("lets a viewer read the persona text but hides every action", async () => {
    signIn("viewer");
    stubFetch();
    renderPage();
    const row = await screen.findByTestId(`agents-persona-${persona.id}`);
    fireEvent.click(within(row).getByRole("button", { name: S.view }));
    expect(await screen.findByText("You are Tom the cat.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: S.disable })).toBeNull();
    expect(screen.queryByRole("button", { name: S.tools.run })).toBeNull();
    expect(screen.queryByRole("button", { name: S.dismiss })).toBeNull();
  });

  it("disables a persona with a reason", async () => {
    const calls = stubFetch();
    renderPage();
    const row = await screen.findByTestId(`agents-persona-${persona.id}`);
    fireEvent.click(within(row).getByRole("button", { name: S.disable }));
    fireEvent.change(screen.getByLabelText("理由"), { target: { value: "冒充官方" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/personas/${persona.id}/disable`))).toBe(true));
    const post = calls.find((c) => c.url.endsWith(`/personas/${persona.id}/disable`));
    expect(body(post!)).toEqual({ reason: "冒充官方" });
  });

  it("searches with a POST body, never the URL", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByTestId(`agents-persona-${persona.id}`);
    fireEvent.change(screen.getByLabelText(S.search), { target: { value: "tom" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/personas/query")).length).toBe(2));
    const last = calls.filter((c) => c.url.includes("/personas/query")).at(-1)!;
    expect(last.url).not.toContain("tom");
    expect(body(last)).toEqual({ q: "tom", status: "all", page: 1 });
  });

  it("dismisses reports and runs the tools probe", async () => {
    const calls = stubFetch();
    renderPage();
    const report = await screen.findByTestId(`agents-report-${persona.id}`);
    fireEvent.click(within(report).getByRole("button", { name: S.dismiss }));
    fireEvent.change(screen.getByLabelText("理由"), { target: { value: "正常角色" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/reports/${persona.id}/resolve`))).toBe(true));
    expect(body(calls.find((c) => c.url.endsWith("/resolve"))!)).toEqual({ action: "dismiss", reason: "正常角色" });
    fireEvent.click(screen.getByRole("button", { name: S.tools.run }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/probe-tools") && c.init?.method === "POST")).toBe(true));
  });

  it("edits the persona text with a reason", async () => {
    const calls = stubFetch();
    renderPage();
    const row = await screen.findByTestId(`agents-persona-${persona.id}`);
    fireEvent.click(within(row).getByRole("button", { name: S.view }));
    fireEvent.change(await screen.findByLabelText(S.dialog.prompt), { target: { value: "Be a cat." } });
    fireEvent.change(screen.getByLabelText(S.dialog.reason), { target: { value: "去掉冒犯内容" } });
    fireEvent.click(screen.getByRole("button", { name: S.dialog.save }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(body(calls.find((c) => c.init?.method === "PATCH")!)).toEqual({ prompt: "Be a cat.", reason: "去掉冒犯内容" });
  });
});
