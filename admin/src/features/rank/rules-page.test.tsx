import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { RulesPage } from "./rules-page";
import { defaultRules } from "./test-fixtures";

vi.mock("./api");
const asRole = (role: session.Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "u", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null, totpEnabled: true,
    safeMode: false, maintenanceMode: "off",
  });

beforeEach(() => {
  vi.mocked(api.getRules).mockResolvedValue({
    published: { version: 3, rules: defaultRules(), publishedAt: "2026-10-08T10:00:00Z", publishedBy: "root" },
    draft: { rules: defaultRules(), note: "", basedOn: 3, updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "e-reviewed" },
    versions: [{ version: 3, publishedAt: "2026-10-08T10:00:00Z", publishedBy: "root", note: "" }],
  });
  vi.mocked(api.validateDraft).mockResolvedValue({ errors: [] });
});

it("edits weights, blocks saving when they do not sum to 100%", async () => {
  asRole("operator");
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("tab", { name: "晋级赛" }));
  const speech = screen.getByLabelText("发音与流利 权重(%)");
  await userEvent.clear(speech);
  await userEvent.type(speech, "30");
  expect(screen.getByText("权重合计 110%,必须为 100%")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

it("maps server validation codes to tabs and hides publish from operators", async () => {
  asRole("operator");
  vi.mocked(api.validateDraft).mockResolvedValue({ errors: ["scenario_pool:3", "judge_prompt_fields"] });
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "校验" }));
  const bar = screen.getByTestId("draft-bar");
  expect(within(bar).getByText("2 个问题")).toBeInTheDocument();
  expect(screen.getByText("铂金的启用情景少于 2 个")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
});

it("publishes with a reason for superadmins", async () => {
  asRole("superadmin");
  vi.mocked(api.publishDraft).mockResolvedValue({ version: 4 });
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "发布" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "活动周提高上限");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.publishDraft).toHaveBeenCalledWith("活动周提高上限", "e-reviewed"); // bound to the draft shown (review M4)
});

it("saves an edited number, then shows the change against the published version", async () => {
  asRole("operator");
  vi.mocked(api.saveDraft).mockResolvedValue({ rules: defaultRules(), note: "", etag: "e1" });
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  const cap = await screen.findByLabelText("每日上限(跟读/对话/复习合计)");
  await userEvent.clear(cap);
  await userEvent.type(cap, "90");
  expect(screen.getByText("未保存的修改 1 处")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  const saved = vi.mocked(api.saveDraft).mock.calls[0][0];
  expect(saved.points.daily_cap).toBe(90);
  expect(await screen.findByText("草稿已保存")).toBeInTheDocument();
  expect(screen.queryByText(/未保存的修改/)).toBeNull();
});

it("is read-only for viewers and offers a new draft to operators when none exists", async () => {
  vi.mocked(api.getRules).mockResolvedValue({
    published: null, v0: defaultRules(), draft: null, versions: [], seasonStarted: false,
  });
  vi.mocked(api.createDraft).mockResolvedValue({ rules: defaultRules(), note: "", etag: "e2" });
  asRole("viewer");
  const { unmount } = render(<MemoryRouter><RulesPage /></MemoryRouter>);
  expect(await screen.findByLabelText("每日上限(跟读/对话/复习合计)")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "新建草稿" })).toBeNull();
  unmount();
  asRole("operator");
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "新建草稿" }));
  expect(api.createDraft).toHaveBeenCalledWith(null);
});

it("simulates the draft and shows the impact panel", async () => {
  asRole("operator");
  const { impactFixture } = await import("./test-fixtures");
  vi.mocked(api.simulateDraft).mockResolvedValue(impactFixture());
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "预演" }));
  expect(await screen.findByTestId("sim-gate")).toHaveTextContent("12→9");
});

it("publishes the etag of its own save when it had unsaved edits", async () => {
  asRole("superadmin");
  vi.mocked(api.saveDraft).mockResolvedValue({ rules: defaultRules(), note: "", etag: "e-saved" });
  vi.mocked(api.publishDraft).mockResolvedValue({ version: 4 });
  render(<MemoryRouter><RulesPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("tab", { name: "晋级赛" }));
  const speech = screen.getByLabelText("发音与流利 权重(%)");
  const task = screen.getByLabelText("任务完成 权重(%)");
  const s = Number((speech as HTMLInputElement).value);
  const t = Number((task as HTMLInputElement).value);
  await userEvent.clear(speech);
  await userEvent.type(speech, String(s - 5));
  await userEvent.clear(task);
  await userEvent.type(task, String(t + 5));
  await userEvent.click(screen.getByRole("button", { name: "发布" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "调整权重");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.saveDraft).toHaveBeenCalled();
  expect(api.publishDraft).toHaveBeenCalledWith("调整权重", "e-saved");
});
