import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { MyInvitePanel } from "./my-invite-panel";

const CODE = "ABCDE-FGHJK";
const ME = { id: "12345678", name: "alice", created_at: "t", nickname: "小明", display_name: "小明" };
const eligible = (over: Record<string, unknown> = {}) => ({ eligible: true, uses: 0, cap: 10, invitees: [] as unknown[], ...over });
const CREATED = eligible({ code: CODE });

function renderPanel(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock({ "GET /api/me": () => json(ME), ...routes });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider fetchImpl={mock.fetch}>{children}</AuthProvider>
    </MemoryRouter>
  );
  render(<MyInvitePanel />, { wrapper });
  return mock;
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

describe("MyInvitePanel", () => {
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    sessionStorage.clear();
    saveAuth({ token: "tok", user: { id: "12345678", name: "alice" } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("explains that the account is too new and gives the date it becomes eligible", async () => {
    const at = "2026-10-20T00:00:00Z";
    renderPanel({ "GET /api/me/invite": () => json({ eligible: false, reason: "too_new", available_at: at }) });
    expect(await screen.findByTestId("my-invite-reason")).toHaveTextContent(`You can create an invite code from ${dateOf(at)}.`);
    expect(screen.queryByRole("button", { name: "Create my invite code" })).toBeNull();
  });

  it("asks for a verified email and links to the bind page", async () => {
    renderPanel({ "GET /api/me/invite": () => json({ eligible: false, reason: "email_unverified", available_at: null }) });
    const reason = await screen.findByTestId("my-invite-reason");
    expect(reason).toHaveTextContent("Bind and verify an email first.");
    expect(within(reason).getByRole("link", { name: "Bind email" })).toHaveAttribute("href", "/account/email");
  });

  it("says the invite permission was withdrawn when the cap is set to zero", async () => {
    renderPanel({ "GET /api/me/invite": () => json({ eligible: false, reason: "invites_disabled", available_at: null }) });
    expect(await screen.findByTestId("my-invite-reason")).toHaveTextContent("Your invite permission has been withdrawn.");
  });

  it("creates the permanent code on request and then shows it with usage and invitees", async () => {
    const mock = renderPanel({
      "GET /api/me/invite": () => json(eligible()),
      "POST /api/me/invite": () => json(CREATED),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Create my invite code" }));
    expect(await screen.findByTestId("my-invite-code")).toHaveTextContent(CODE);
    expect(screen.getByTestId("my-invite-usage")).toHaveTextContent("Used 0 of 10");
    expect(screen.getByText("No one has used your code yet.")).toBeInTheDocument();
    expect(mock.calls.find((c) => c.method === "POST")?.url.search).toBe("");
  });

  it("lists invitees by display name and join date only", async () => {
    renderPanel({
      "GET /api/me/invite": () => json(eligible({
        code: CODE, uses: 2,
        invitees: [{ display_name: "小红", joined_at: "2026-10-18T09:00:00Z" }, { display_name: "Tom", joined_at: "2026-10-17T09:00:00Z" }],
      })),
    });
    const list = await screen.findByTestId("my-invite-invitees");
    expect(within(list).getByText("小红")).toBeInTheDocument();
    expect(within(list).getByText("Tom")).toBeInTheDocument();
    expect(list.textContent).toContain(dateOf("2026-10-18T09:00:00Z"));
    expect(list.textContent).not.toMatch(/@|alice/);
  });

  it("copies the share link (the code only in the # fragment) and reports success", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE })) });
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByTestId("my-invite-note")).toHaveTextContent("Copied"));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toMatch(/\/register#invite=ABCDE-FGHJK$/);
    expect(copied).not.toContain("?");
  });

  it("reports a copy failure gracefully instead of throwing", async () => {
    const writeText = vi.fn(async (_text: string) => { throw new Error("denied"); });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE })) });
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByTestId("my-invite-note")).toHaveTextContent("Copy failed. Select the code and copy it by hand.");
  });

  it("never writes the code to localStorage or sessionStorage", async () => {
    renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE })) });
    await screen.findByTestId("my-invite-code");
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) expect(store.getItem(store.key(i) ?? "")).not.toContain(CODE);
    }
  });

  it("asks for confirmation before replacing and says the old code stops and the count carries over", async () => {
    const mock = renderPanel({
      "GET /api/me/invite": () => json(eligible({ code: CODE, uses: 3 })),
      "POST /api/me/invite/rotate": () => json(eligible({ code: "KMNPQ-RSTVW", uses: 3 })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Replace invite code" }));
    const confirm = await screen.findByTestId("my-invite-confirm");
    expect(confirm).toHaveTextContent("The old code stops working right away.");
    expect(confirm).toHaveTextContent("3 of 10");
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.click(within(confirm).getByRole("button", { name: "Replace code" }));
    expect(await screen.findByTestId("my-invite-code")).toHaveTextContent("KMNPQ-RSTVW");
    const rotate = mock.calls.find((c) => c.method === "POST");
    expect(JSON.parse(rotate?.body as string)).toEqual({ confirm: true });
    expect(screen.queryByTestId("my-invite-confirm")).toBeNull();
  });

  it("cancelling the replacement keeps the current code", async () => {
    const mock = renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE })) });
    await userEvent.click(await screen.findByRole("button", { name: "Replace invite code" }));
    await userEvent.click(within(await screen.findByTestId("my-invite-confirm")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("my-invite-code")).toHaveTextContent(CODE);
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("when all uses are taken it says so, and offers no share actions", async () => {
    renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE, uses: 10, cap: 10 })) });
    expect(await screen.findByTestId("my-invite-usage")).toHaveTextContent("Used 10 of 10");
    expect(screen.getByTestId("my-invite-used-up")).toHaveTextContent("All uses taken.");
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("shows a fixed unavailable message when the server has no invite key configured", async () => {
    renderPanel({ "GET /api/me/invite": () => json({ error: "Invites are not configured" }, 503) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Invites are not available right now.");
  });

  it("a live code that cannot be shown (rotate_required) asks to replace it, never offers a create", async () => {
    const mock = renderPanel({
      "GET /api/me/invite": () => json({ eligible: true, reason: "rotate_required", available_at: null, code: null, uses: 2, cap: 10, invitees: [] }),
      "POST /api/me/invite/rotate": () => json(eligible({ code: "KMNPQ-RSTVW", uses: 2 })),
    });
    expect(await screen.findByTestId("my-invite-reason")).toHaveTextContent("Your current code can no longer be shown. Replace it to get a new one.");
    expect(screen.queryByRole("button", { name: "Create my invite code" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Replace invite code" }));
    await userEvent.click(within(await screen.findByTestId("my-invite-confirm")).getByRole("button", { name: "Replace code" }));
    expect(await screen.findByTestId("my-invite-code")).toHaveTextContent("KMNPQ-RSTVW");
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST")?.body as string)).toEqual({ confirm: true });
  });

  it("a refused create (403 Not eligible) re-reads the state and explains the reason with its date", async () => {
    const at = "2026-10-20T00:00:00Z";
    let state = 0;
    renderPanel({
      "GET /api/me/invite": () => (state++ === 0
        ? json(eligible())
        : json({ eligible: false, reason: "too_new", available_at: at, code: null, uses: 0, cap: 10, invitees: [] })),
      "POST /api/me/invite": () => json({ error: "Not eligible", reason: "too_new", available_at: at }, 403),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Create my invite code" }));
    expect(await screen.findByTestId("my-invite-reason")).toHaveTextContent(`You can create an invite code from ${dateOf(at)}.`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a replace that finds no code (409) re-reads the state and offers to create one", async () => {
    let state = 0;
    renderPanel({
      "GET /api/me/invite": () => (state++ === 0
        ? json(eligible({ code: CODE, uses: 1 }))
        : json(eligible())),
      "POST /api/me/invite/rotate": () => json({ error: "No invite code to replace" }, 409),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Replace invite code" }));
    await userEvent.click(within(await screen.findByTestId("my-invite-confirm")).getByRole("button", { name: "Replace code" }));
    expect(await screen.findByRole("button", { name: "Create my invite code" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("my-invite-confirm")).toBeNull();
  });

  it("when the daily action budget is spent (429) it says to try again later", async () => {
    renderPanel({
      "GET /api/me/invite": () => json(eligible()),
      "POST /api/me/invite": () => json({ error: "Too many requests, please try again later" }, 429),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Create my invite code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many invite changes today. Please try again later.");
  });

  it("explains that the replacement inherits the old used count and says so in the confirmation", async () => {
    renderPanel({ "GET /api/me/invite": () => json(eligible({ code: CODE, uses: 4 })) });
    await userEvent.click(await screen.findByRole("button", { name: "Replace invite code" }));
    expect(await screen.findByTestId("my-invite-confirm")).toHaveTextContent("The new code inherits the 4 of 10 uses already counted");
  });
});
