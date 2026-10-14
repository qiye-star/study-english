import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { ChangelogPage } from "./changelog-page";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listEntries: vi.fn(), createEntry: vi.fn(), updateEntry: vi.fn(), publishEntry: vi.fn(), unpublishEntry: vi.fn(), deleteEntry: vi.fn(),
}));

const STAMP = "2026-10-14T00:00:00+00:00";
const sessionOf = (role: "viewer" | "operator") => ({
  username: "u", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null, totpEnabled: true, safeMode: false,
  maintenanceMode: "off" as const,
});
const entry = (id: number, status: api.EntryStatus, entryDate: string, titleZh: string, over: Partial<api.ChangelogEntry> = {}): api.ChangelogEntry => ({
  id, status, entryDate, version: null, titleZh, titleEn: "", items: [{ tag: "new", zh: `${titleZh}的内容`, en: "" }], createdBy: "operator1",
  createdAt: STAMP, updatedAt: STAMP, publishedAt: status === "published" ? STAMP : null, ...over,
});
const LIST = [
  entry(3, "draft", "2026-10-14", "草稿标题"),
  entry(2, "published", "2026-10-13", "已发布标题", { version: "v1.12", titleEn: "Published title" }),
  entry(1, "published", "2026-10-11", "更早的标题"),
];

const open = async () => {
  render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
  await screen.findByRole("list", { name: "更新列表" });
};
const row = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.mocked(api.listEntries).mockReset().mockResolvedValue(LIST);
  for (const fn of [api.createEntry, api.updateEntry, api.publishEntry, api.unpublishEntry, api.deleteEntry]) vi.mocked(fn).mockReset();
  vi.mocked(api.createEntry).mockResolvedValue(entry(9, "draft", "2026-10-14", "新的标题"));
  vi.mocked(api.publishEntry).mockResolvedValue(entry(3, "published", "2026-10-14", "草稿标题"));
  vi.mocked(api.unpublishEntry).mockResolvedValue(entry(2, "draft", "2026-10-13", "已发布标题"));
  vi.mocked(api.deleteEntry).mockResolvedValue(undefined);
  vi.spyOn(session, "useAdminSession").mockReturnValue(sessionOf("operator"));
});

describe("ChangelogPage", () => {
  it("lists drafts and published entries with status badges and filters by status", async () => {
    await open();
    const list = screen.getByRole("list", { name: "更新列表" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("草稿")).toBeInTheDocument();
    expect(within(list).getAllByText("已发布")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "草稿" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "已发布" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an empty state when there is nothing yet", async () => {
    vi.mocked(api.listEntries).mockResolvedValue([]);
    render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
    expect(await screen.findByText("还没有更新日志")).toBeInTheDocument();
  });

  it("shows a failure with a retry", async () => {
    vi.mocked(api.listEntries).mockReset().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(LIST);
    render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("list", { name: "更新列表" })).toBeInTheDocument();
  });

  it("opens an entry in the editor with its values", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    expect(screen.getByLabelText("发布日期")).toHaveValue("2026-10-13");
    expect(screen.getByLabelText("版本号(可选)")).toHaveValue("v1.12");
    expect(screen.getByLabelText("标题")).toHaveValue("已发布标题");
    expect(screen.getByLabelText("条目 1 文字")).toHaveValue("已发布标题的内容");
    expect(screen.getByLabelText("类型 1")).toHaveValue("new");
    expect(screen.getByRole("button", { name: "下架" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // nothing changed yet
  });

  it("creates a draft from the form with trimmed values", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("发布日期"), { target: { value: "2026-10-14" } });
    await userEvent.type(screen.getByLabelText("标题"), "  新的标题 ");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "新的一句");
    await userEvent.selectOptions(screen.getByLabelText("类型 1"), "fix");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry).toHaveBeenCalledWith({
      entryDate: "2026-10-14", version: null, titleZh: "新的标题", titleEn: "", items: [{ tag: "fix", zh: "新的一句", en: "" }],
    });
    await waitFor(() => expect(api.listEntries).toHaveBeenCalledTimes(2)); // the list reloads
  });

  it("edits the English title and item text with the language switch", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("发布日期"), { target: { value: "2026-10-14" } });
    await userEvent.type(screen.getByLabelText("标题"), "中文标题");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "中文句子");
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByLabelText("标题")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("标题"), "English title");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "English sentence");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createEntry).toHaveBeenCalled());
    expect(api.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      titleZh: "中文标题", titleEn: "English title", items: [{ tag: "new", zh: "中文句子", en: "English sentence" }],
    }));
  });

  it("keeps save disabled until the form is valid and caps the items at 20", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("标题"), "标题");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "一句");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    const add = screen.getByRole("button", { name: "+ 添加条目" });
    for (let i = 0; i < 19; i += 1) await userEvent.click(add);
    expect(screen.getAllByLabelText(/^条目 \d+ 文字$/)).toHaveLength(20);
    expect(add).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // 19 empty rows are invalid
    await userEvent.click(screen.getByRole("button", { name: "删除条目 20" }));
    expect(add).toBeEnabled();
  });

  it("publishes a draft after confirmation, saving first when the form changed", async () => {
    vi.mocked(api.updateEntry).mockResolvedValue(entry(3, "draft", "2026-10-14", "改过的标题"));
    await open();
    await userEvent.click(row(/草稿标题/));
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("发布这条更新?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(api.publishEntry).toHaveBeenCalledWith(3));
    expect(api.updateEntry).not.toHaveBeenCalled();
    // the same again with an unsaved change
    await userEvent.click(row(/草稿标题/));
    await userEvent.clear(screen.getByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "改过的标题");
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith(3, expect.objectContaining({ titleZh: "改过的标题" })));
    expect(api.publishEntry).toHaveBeenCalledTimes(2);
  });

  it("unpublishes and deletes after confirmation", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "下架" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "下架" }));
    await waitFor(() => expect(api.unpublishEntry).toHaveBeenCalledWith(2));
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(within(screen.getByRole("dialog")).getByText("删除这条更新?")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.deleteEntry).toHaveBeenCalledWith(2));
  });

  it("previews the phone card and falls back to Chinese when the English text is empty", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "预览" }));
    const preview = screen.getByTestId("changelog-preview");
    expect(within(preview).getByText("已发布标题")).toBeInTheDocument();
    expect(within(preview).getByText("新功能")).toBeInTheDocument();
    expect(within(preview).getByText(/v1\.12/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(within(screen.getByTestId("changelog-preview")).getByText("Published title")).toBeInTheDocument();
    expect(within(screen.getByTestId("changelog-preview")).getByText("已发布标题的内容")).toBeInTheDocument(); // English item blank -> Chinese
  });

  it("is read-only for a viewer", async () => {
    vi.spyOn(session, "useAdminSession").mockReturnValue(sessionOf("viewer"));
    await open();
    expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
    await userEvent.click(row(/已发布标题/));
    expect(screen.getByLabelText("标题")).toBeDisabled();
    expect(screen.getByLabelText("条目 1 文字")).toBeDisabled();
    for (const name of ["保存", "发布", "下架", "删除"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByText(/需要「运营」及以上角色/)).toBeInTheDocument();
  });

  it("is in the navigation for every role, after announcements", async () => {
    const { NAV } = await import("../../components/layout");
    const config = NAV.find((g) => g.group === "配置");
    expect(config?.items.find((i) => i.to === "/changelog")).toMatchObject({ label: "更新日志", min: "viewer" });
    const paths = config!.items.map((i) => i.to);
    expect(paths.indexOf("/changelog")).toBe(paths.indexOf("/announcements") + 1);
  });
});
