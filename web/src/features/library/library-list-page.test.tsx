import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LibraryListPage } from "./library-list-page";
import { CONFIG_OFF_RAW, CONFIG_RAW, itemRaw } from "./test-fixtures";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./catalog-view", () => ({
  CatalogView: ({ onCopyRemoved }: { onCopyRemoved?: (id: string) => void }) => (
    <div>
      <p data-testid="catalog-view-stub">catalog view</p>
      <button type="button" onClick={() => onCopyRemoved?.("i1")}>stub-remove</button>
    </div>
  ),
}));

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

function render(items: Record<string, unknown>[], extra: Record<string, Handler> = {}, config: unknown = CONFIG_RAW, route = "/library") {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(config),
    "GET /api/library/items": () => json({ items, next_cursor: null }),
    ...extra,
  });
  renderWithProviders(<LibraryListPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route, path: "/library" });
  return mock;
}

describe("LibraryListPage (spec §11.2)", () => {
  it("goes back to the practice page when the library is off", async () => {
    render([], {}, CONFIG_OFF_RAW);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("shows usage, an empty state and the add button", async () => {
    render([]);
    expect(await screen.findByText("还没有素材。上传音视频文件或导入链接,然后逐句跟读。")).toBeInTheDocument();
    const usage = screen.getByTestId("library-usage");
    expect(usage).toHaveTextContent("已用");
    expect(usage).toHaveTextContent("10.0 MB"); // CountUp 的 sr-only 终值;可见的数字是滚动中的 aria-hidden 值
    expect(usage).toHaveTextContent("2.0 GB");
    fireEvent.click(screen.getByTestId("library-add"));
    expect(await screen.findByTestId("library-upload-form")).toBeInTheDocument();
  });

  it("is a tab root on the library surface: no back button, a specular add button and the aurora", async () => {
    render([]);
    await screen.findByTestId("library-add");
    expect(document.querySelector("header")?.querySelector("button")).toBeNull();
    expect(screen.getByTestId("library-add").className).toMatch(/\blib-spec\b/);
    expect(document.querySelector(".library-root.lib-page")).not.toBeNull();
    expect(document.querySelector(".lib-aurora")).not.toBeNull();
  });

  it("fills the usage bar to the used share of the quota", async () => {
    render([]);
    await screen.findByTestId("library-add");
    const fill = document.querySelector(".lib-quota-fill") as HTMLElement;
    expect(Number(fill.style.getPropertyValue("--p"))).toBeCloseTo(10 / 2000, 5);
  });

  it("lists ready, processing and failed items", async () => {
    render([
      itemRaw(),
      itemRaw({ id: "p1", title: "Pod", kind: "audio", status: "processing", stage: "transcribe", progress: 70 }),
      itemRaw({ id: "f1", title: "Broken", status: "failed", error_kind: "no_subtitles" }),
    ]);
    expect(await screen.findByRole("link", { name: /Lecture 1/ })).toHaveAttribute("href", "/library/i1");
    expect(screen.getByText("转写中 · 70%")).toBeInTheDocument();
    expect(within(screen.getByTestId("library-item-f1")).getByRole("button", { name: "补传字幕" })).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    const mock = render([itemRaw()], { "DELETE /api/library/items/i1": () => new Response(null, { status: 204 }) });
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("删除这条素材?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByTestId("library-item-i1")).toBeNull());
    expect(mock.calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/library/items/i1")).toBe(true);
  });

  it("retries a failed item and shows it queued", async () => {
    render([itemRaw({ id: "f1", status: "failed", error_kind: "upstream" })], {
      "POST /api/library/items/f1/retry": () => json(itemRaw({ id: "f1", status: "queued", stage: null, progress: 0 })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTestId("library-item-f1")).toHaveAttribute("data-state", "queued"));
  });

  it("adds subtitles to a failed item through the hidden picker", async () => {
    const mock = render([itemRaw({ id: "f1", status: "failed", error_kind: "no_subtitles" })], {
      "PUT /api/library/items/f1/subtitles": () => json(itemRaw({ id: "f1", status: "queued", progress: 0 })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "补传字幕" }));
    fireEvent.change(screen.getByTestId("library-subtitles-input"), { target: { files: [new File(["1\n"], "fix.srt")] } });
    await waitFor(() => expect(screen.getByTestId("library-item-f1")).toHaveAttribute("data-state", "queued"));
    expect(mock.calls.find((c) => c.method === "PUT")?.url.pathname).toBe("/api/library/items/f1/subtitles");
  });

  it("refuses to continue an upload with a different file name remembered in this tab", async () => {
    sessionStorage.setItem("enjoy-web.library.upload.u1", "original.mp4");
    const mock = render([itemRaw({ id: "u1", status: "uploading", duration_ms: null, library_bytes: 0 })]);
    fireEvent.click(await screen.findByRole("button", { name: "继续上传" }));
    fireEvent.change(screen.getByTestId("library-resume-input"), { target: { files: [new File(["x"], "other.mp4")] } });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这不是同一个文件。请选择开始上传时的那个文件。"));
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/library/uploads"))).toBe(false);
    sessionStorage.clear();
  });

  it("re-recognizes an automatically recognized item after confirmation", async () => {
    const mock = render([itemRaw({ sub_source: "asr" })], {
      "POST /api/library/items/i1/reprocess": () => json({ item: itemRaw({ sub_source: "asr", status: "queued", stage: null, progress: 0 }) }),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("重新识别这条素材?")).toBeInTheDocument();
    expect(within(dialog).getByText(/再用掉今天的自动转写额度/)).toBeInTheDocument();
    expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/reprocess"))).toBe(false); // nothing before the confirm
    fireEvent.click(within(dialog).getByRole("button", { name: "重新识别" }));
    await waitFor(() => expect(screen.getByTestId("library-item-i1")).toHaveAttribute("data-state", "queued"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/library/items/i1/reprocess")).toHaveLength(1);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("已开始重新识别。");
  });

  it("sends nothing when the confirmation is canceled", async () => {
    const mock = render([itemRaw({ sub_source: "asr" })]);
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the server's reason as a toast when the allowance is used up", async () => {
    render([itemRaw({ sub_source: "asr" })], {
      "POST /api/library/items/i1/reprocess": () => json({ error: "Daily transcription limit reached" }, 429),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重新识别" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("今天的自动转写额度已用完,明天再试。"));
    expect(screen.getByTestId("library-item-i1")).toHaveAttribute("data-state", "ready");
  });

  it("re-splits a rebuildable item after confirmation, without using the allowance (plan v2)", async () => {
    const segments: Record<string, unknown>[] = [{ idx: 0, start_ms: 1000, end_ms: 2000, text: "Hi.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null, flags: [] }];
    const mock = render([itemRaw({ sub_source: "asr", rebuildable: true })], {
      "POST /api/library/items/i1/rebuild": () => json({ item: itemRaw({ sub_source: "asr", rebuildable: true, seg_count: 1 }), segments }),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("重新分句这条素材?")).toBeInTheDocument();
    expect(within(dialog).getByText(/不用自动转写额度/)).toBeInTheDocument();
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "重新分句" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已重新分句。"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/library/items/i1/rebuild")).toHaveLength(1);
    expect(screen.getByTestId("library-item-i1")).toHaveTextContent("1 句");
  });

  it("explains when an older item cannot be re-split", async () => {
    render([itemRaw({ sub_source: "asr", rebuildable: true })], {
      "POST /api/library/items/i1/rebuild": () => json({ error: "Item cannot be rebuilt" }, 409),
    });
    fireEvent.click(await screen.findByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "重新分句" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这条素材是更早的版本识别的,没有保留识别结果;请用「重新识别」。"));
  });

  it("has no re-recognize action when the server has transcription off", async () => {
    render([itemRaw({ sub_source: "asr" })], {}, { ...CONFIG_RAW, asr: false });
    await screen.findByTestId("library-item-i1");
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });
});

describe("LibraryListPage · featured tab (curated library, R-W1)", () => {
  const ON = { ...CONFIG_RAW, catalog: true };

  it("a copy removed in 精选 is gone from 我的素材 without a reload (R-C6)", async () => {
    const mock = render([itemRaw({ source: "catalog", catalog_id: "c1", library_bytes: 0 })], {}, ON, "/library?tab=catalog");
    await screen.findByTestId("catalog-view-stub");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "GET" && c.url.pathname === "/api/library/items")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "stub-remove" }));
    fireEvent.click(screen.getByTestId("library-tab-mine"));
    await waitFor(() => expect(screen.queryByTestId("catalog-view-stub")).toBeNull());
    expect(screen.queryByTestId("library-item-i1")).toBeNull();
  });

  it("has no switch and ignores ?tab=catalog when config.catalog is off", async () => {
    render([], {}, { ...CONFIG_RAW, catalog: false }, "/library?tab=catalog");
    await screen.findByTestId("library-add");
    expect(screen.queryByTestId("library-tab-catalog")).toBeNull();
    expect(screen.queryByTestId("catalog-view-stub")).toBeNull();
    expect(screen.getByTestId("library-usage")).toBeInTheDocument();
  });

  it("shows the 我的素材 / 精选 switch on 我的 with the usage bar and add button", async () => {
    render([], {}, ON);
    expect(await screen.findByTestId("library-tab-mine")).toHaveTextContent("我的素材");
    expect(screen.getByTestId("library-tab-catalog")).toHaveTextContent("精选");
    expect(screen.getByTestId("library-tab-mine")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("library-usage")).toBeInTheDocument();
    expect(screen.getByTestId("library-add")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-view-stub")).toBeNull();
  });

  it("?tab=catalog renders the catalog view and hides the usage bar and the add button; switching back restores them", async () => {
    render([], {}, ON, "/library?tab=catalog");
    expect(await screen.findByTestId("catalog-view-stub")).toBeInTheDocument();
    expect(screen.getByTestId("library-tab-catalog")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("library-usage")).toBeNull();
    expect(screen.queryByTestId("library-add")).toBeNull();
    fireEvent.click(screen.getByTestId("library-tab-mine"));
    expect(await screen.findByTestId("library-add")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-view-stub")).toBeNull();
  });

  it("deleting a featured copy explains that the catalog original stays (own body text)", async () => {
    render([itemRaw({ source: "catalog", catalog_id: "c1", library_bytes: 0, sub_source: "asr" })], {
      "DELETE /api/library/items/i1": () => new Response(null, { status: 204 }),
    }, ON);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/精选库里的原条目不受影响/)).toBeInTheDocument();
    expect(within(dialog).getByText(/逐句跟读分数和进度也会一起删除/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/媒体文件和句子会被删除/)).toBeNull();
  });

  it("deleting an own item keeps the original text", async () => {
    render([itemRaw()], {}, ON);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(within(await screen.findByRole("alertdialog")).getByText(/媒体文件和句子会被删除/)).toBeInTheDocument();
  });

  it("switching to 精选 shows the catalog view", async () => {
    render([], {}, ON);
    fireEvent.click(await screen.findByTestId("library-tab-catalog"));
    expect(await screen.findByTestId("catalog-view-stub")).toBeInTheDocument();
  });
});
