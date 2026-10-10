import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../../api/session";
import * as api from "../api";
import { RulesPage } from "../rules-page";
import { defaultRules } from "../test-fixtures";

vi.mock("../api");

/** learning links (spec 2026-10-11 §5.3): the two PointsRule fields survive the editor round trip */
function withSources() {
  const r = defaultRules();
  r.points.sources = { word_in_chat: 2 };
  r.points.sources_daily_cap = 5;
  return r;
}

function mockRules(rules: api.RankRules) {
  vi.mocked(api.getRules).mockResolvedValue({
    published: { version: 3, rules, publishedAt: "2026-10-08T10:00:00Z", publishedBy: "root" },
    draft: { rules, note: "", basedOn: 3, updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "e-reviewed" },
    versions: [{ version: 3, publishedAt: "2026-10-08T10:00:00Z", publishedBy: "root", note: "" }],
  });
}

beforeEach(() => {
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "u", role: "operator", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null, totpEnabled: true,
    safeMode: false, maintenanceMode: "off",
  });
  vi.mocked(api.validateDraft).mockResolvedValue({ errors: [] });
  vi.mocked(api.saveDraft).mockResolvedValue({ rules: withSources(), note: "", etag: "e1" });
});

it("keeps link sources when another point value is saved, and edits them", async () => {
  mockRules(withSources());
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  const chat = await screen.findByLabelText("每轮文字对话");
  await userEvent.clear(chat);
  await userEvent.type(chat, "3");
  const source = screen.getByLabelText("word_in_chat 点数");
  await userEvent.clear(source);
  await userEvent.type(source, "4");
  const cap = screen.getByLabelText("联动来源每日上限");
  await userEvent.clear(cap);
  await userEvent.type(cap, "8");
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  const saved = vi.mocked(api.saveDraft).mock.calls.at(-1)![0];
  expect(saved.points.chat_turn).toBe(3);
  expect(saved.points.sources).toEqual({ word_in_chat: 4 });
  expect(saved.points.sources_daily_cap).toBe(8);
});

it("shows the server default sub-cap and an empty note for rules without link sources", async () => {
  mockRules(defaultRules());
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  expect(await screen.findByLabelText("联动来源每日上限")).toHaveValue(5);
  expect(screen.getByText("还没有联动来源;启用学习联动后,来源列表见「学习联动」页")).toBeInTheDocument();
  const chat = screen.getByLabelText("每轮文字对话");
  await userEvent.clear(chat);
  await userEvent.type(chat, "2");
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  const saved = vi.mocked(api.saveDraft).mock.calls.at(-1)![0];
  expect(saved.points.chat_turn).toBe(2);
  expect("sources" in saved.points || "sources_daily_cap" in saved.points).toBe(false); // untouched fields stay absent
});

it("blocks saving an out-of-range source value", async () => {
  mockRules(withSources());
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  const source = await screen.findByLabelText("word_in_chat 点数");
  await userEvent.clear(source);
  await userEvent.type(source, "101");
  expect(source).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});
