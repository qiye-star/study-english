import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { AuditPage } from "./audit-page";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: role === "viewer" ? "vic" : "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });

const ITEMS: api.AuditItem[] = [
  {
    id: 12, at: "2026-10-09T10:05:00Z", actor: "root", role: "superadmin", ip: "203.0.113.5", action: "settings.update",
    targetType: "setting", targetId: "upstream_llm_key,rate_limit_per_minute", summary: "2 setting(s)",
    before: { upstream_llm_key: { set: true, fp: "a1b2c3d4" }, rate_limit_per_minute: 10 },
    after: { upstream_llm_key: { set: true, fp: "9f8e7d6c" }, rate_limit_per_minute: 25 }, reason: "轮换密钥", result: "ok",
  },
  {
    id: 11, at: "2026-10-09T10:00:00Z", actor: "mallory", role: "-", ip: "198.51.100.7", action: "auth.login.fail",
    targetType: null, targetId: null, summary: "", before: null, after: null, reason: null, result: "denied",
  },
];

beforeEach(() => {
  vi.mocked(api.listAudit).mockResolvedValue({ items: ITEMS, nextBeforeId: null });
  vi.mocked(api.verifyAudit).mockResolvedValue({ ok: true, brokenAt: null });
});
afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );

it("lists newest first, filters by action prefix and expands a diff with fingerprints only", async () => {
  asRole("operator");
  renderPage();
  const table = await screen.findByRole("table", { name: "审计日志" });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveAttribute("data-testid", "audit-12");
  expect(rows[2]).toHaveAttribute("data-testid", "audit-11");
  expect(within(rows[2]).getByText("拒绝")).toBeInTheDocument();
  expect(await screen.findByText("哈希链完整")).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText("动作"), "settings.");
  expect(api.listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ actionPrefix: "settings." }));

  await userEvent.click(within(screen.getByTestId("audit-12")).getByRole("button", { name: "展开" }));
  expect(await screen.findByText("已设置 · a1b2c3d4")).toBeInTheDocument();
  expect(screen.getByText("已设置 · 9f8e7d6c")).toBeInTheDocument();
  expect(screen.getByText("25")).toBeInTheDocument();
  expect(screen.getByText("轮换密钥")).toBeInTheDocument();
});

it("shows a broken hash chain", async () => {
  asRole("operator");
  vi.mocked(api.verifyAudit).mockResolvedValue({ ok: false, brokenAt: 42 });
  renderPage();
  expect(await screen.findByText("第 42 条起链断裂")).toBeInTheDocument();
});

it("pins viewers to their own entries and skips verification", async () => {
  asRole("viewer");
  renderPage();
  await screen.findByRole("table", { name: "审计日志" });
  expect(screen.getByLabelText("操作人")).toBeDisabled();
  expect(screen.getByLabelText("操作人")).toHaveValue("vic");
  expect(api.verifyAudit).not.toHaveBeenCalled();
});
