import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { PromptEditorPage } from "./prompt-editor-page";
import { S } from "./strings";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });

beforeEach(() => {
  vi.mocked(api.getPrompt).mockResolvedValue({
    spec: { key: "rooms.assist", label: "联机助手组句", kind: "text", required: ["level", "chat", "draft"],
            boundaries: ["<chat>", "</chat>", "<draft>", "</draft>"], maxChars: 8000 },
    published: null, versions: [], defaultBody: "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>",
    draft: { body: "Level {level}. <chat>{chat}</chat>", note: "", updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "p0" },
  });
  asRole("operator");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(api.getPrompt).mockReset();
});

const renderAt = (key = "rooms.assist") =>
  render(<MemoryRouter initialEntries={[`/prompts/${key}`]}><Routes><Route path="/prompts/:key" element={<PromptEditorPage />} /></Routes></MemoryRouter>);

const VALID = "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>";

it("lists missing placeholders and boundaries and blocks saving", async () => {
  renderAt();
  expect(await screen.findByText("缺少占位符:{draft}")).toBeInTheDocument();
  expect(screen.getByText("缺少边界标签:<draft>、</draft>")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

it("hides publish and test-run from operators", async () => {
  renderAt();
  await screen.findByText(/缺少占位符/);
  expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
  expect(screen.queryByRole("button", { name: /运行/ })).toBeNull();
});

it("updates checks live while typing", async () => {
  renderAt();
  const editor = await screen.findByLabelText("提示词正文");
  await userEvent.clear(editor);
  // user-event v14: "{{" types a literal "{"; "}" is already literal (the plan wrote "}}", which types two)
  await userEvent.type(editor, "Level {{level}. <chat>{{chat}</chat> <draft>{{draft}</draft>");
  expect(screen.queryByText(/缺少占位符/)).toBeNull();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
});

it("saves the draft with the note", async () => {
  vi.mocked(api.savePromptDraft).mockResolvedValue({ body: VALID, note: "n", updatedBy: "ops", updatedAt: "2026-10-09T09:00:00Z", etag: "p1" });
  renderAt();
  const editor = await screen.findByLabelText("提示词正文");
  await userEvent.clear(editor);
  await userEvent.type(editor, VALID.replace(/[{]/g, "{{"));
  await userEvent.type(screen.getByLabelText("草稿说明"), "n");
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(api.savePromptDraft).toHaveBeenCalledWith("rooms.assist", VALID, "n");
});

it("lets a superadmin publish a valid saved draft with a reason and run a test", async () => {
  asRole("superadmin");
  vi.mocked(api.getPrompt).mockResolvedValue({
    spec: { key: "rooms.assist", label: "联机助手组句", kind: "text", required: ["level", "chat", "draft"],
            boundaries: ["<chat>", "</chat>", "<draft>", "</draft>"], maxChars: 8000,
            sampleFields: ["level", "scenario", "chat", "draft"] },
    published: { version: 2, body: "old line\nshared" },
    versions: [
      { version: 2, status: "published", note: "", createdBy: "a", createdAt: "2026-10-01T00:00:00Z", publishedBy: "root", publishedAt: "2026-10-01T00:00:00Z" },
      { version: 1, status: "archived", note: "", createdBy: "a", createdAt: "2026-09-01T00:00:00Z", publishedBy: "root", publishedAt: "2026-09-01T00:00:00Z" },
    ],
    defaultBody: null,
    draft: { body: VALID, note: "", updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "p-reviewed" },
  });
  vi.mocked(api.publishPrompt).mockResolvedValue({ version: 3 });
  vi.mocked(api.testPrompt).mockResolvedValue({ output: "Hello there", ms: 812 });
  renderAt();
  await screen.findByText("检查通过");
  // version list + diff against the published body
  expect(screen.getByText("v2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "对比已发布版本" }));
  expect(screen.getByText("old line")).toBeInTheDocument();
  // test run
  await userEvent.type(screen.getByLabelText("学习者草稿"), "what is up");
  await userEvent.click(screen.getByRole("button", { name: "运行(会产生少量费用)" }));
  expect(api.testPrompt).toHaveBeenCalledWith("rooms.assist", VALID, { level: "", scenario: "", chat: "", draft: "what is up" });
  expect(await screen.findByText("Hello there")).toBeInTheDocument();
  // publish
  await userEvent.click(screen.getByRole("button", { name: "发布" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByRole("textbox"), "上线新版本");
  await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
  expect(api.publishPrompt).toHaveBeenCalledWith("rooms.assist", "上线新版本", "p-reviewed"); // review M4
});

it("offers a new draft when none exists and rollback from a version", async () => {
  vi.mocked(api.getPrompt).mockResolvedValue({
    spec: { key: "grammar.rules", label: "语法检查规则", kind: "text", required: [], boundaries: [], maxChars: 2000, formatted: false },
    published: { version: 1, body: "Only tense." },
    versions: [{ version: 1, status: "published", note: "", createdBy: "a", createdAt: "2026-10-01T00:00:00Z", publishedBy: "root", publishedAt: "2026-10-01T00:00:00Z" }],
    defaultBody: "Built-in rules",
    draft: null,
  });
  vi.mocked(api.createPromptDraft).mockResolvedValue({ body: "Only tense.", note: "", updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "p2" });
  renderAt("grammar.rules");
  const editor = await screen.findByLabelText("提示词正文");
  expect(editor).toHaveValue("Only tense.");
  expect(editor).toHaveAttribute("readonly");
  expect(screen.getByText(/输出格式由服务端固定追加/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "以此版本新建草稿" }));
  expect(api.createPromptDraft).toHaveBeenCalledWith("grammar.rules", 1);
  await userEvent.click(screen.getByRole("button", { name: "新建草稿" }));
  expect(api.createPromptDraft).toHaveBeenLastCalledWith("grammar.rules");
});

it("hides editing from viewers", async () => {
  asRole("viewer");
  renderAt();
  await screen.findByText(/缺少占位符/);
  expect(screen.queryByRole("button", { name: "保存草稿" })).toBeNull();
  expect(screen.getByLabelText("提示词正文")).toHaveAttribute("readonly");
});

it("has no sample labels left for the retired @ai answer prompt", () => {
  for (const retired of ["topic", "asker", "question"]) expect(S.sampleLabels).not.toHaveProperty(retired);
  expect(Object.keys(S.sampleLabels).sort()).toEqual(["chat", "context", "draft", "level", "text"]);
});
