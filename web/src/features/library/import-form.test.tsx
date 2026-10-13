import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ImportForm, isHttpUrl } from "./import-form";
import { itemRaw } from "./test-fixtures";

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

const DRM = "支持 yt-dlp 能直接下载的公开视频页面(如 YouTube 等)。受 DRM 保护的流媒体服务(Netflix、Disney+、爱奇艺、腾讯视频、优酷、Spotify 等)无法导入,请使用你自己拥有的文件上传。";

describe("isHttpUrl (R-L19)", () => {
  it("accepts only full http(s) links without credentials", () => {
    expect(isHttpUrl("https://www.youtube.com/watch?v=x")).toBe(true);
    expect(isHttpUrl(" http://example.com/a ")).toBe(true);
    expect(isHttpUrl("ftp://example.com/a")).toBe(false);
    expect(isHttpUrl("youtube.com/watch?v=x")).toBe(false);
    expect(isHttpUrl("https://user:pw@example.com/")).toBe(false);
    expect(isHttpUrl(`https://example.com/${"a".repeat(2000)}`)).toBe(false);
  });
});

describe("ImportForm (spec §7.4)", () => {
  it("only explains when link import is off, and always shows the DRM notice", () => {
    renderWithProviders(<ImportForm linkImport={false} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-drm-note")).toHaveTextContent(DRM);
    expect(screen.getByTestId("library-link-disabled")).toHaveTextContent("管理员没有开启链接导入。");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("validates locally without a request", () => {
    const mock = createFetchMock({});
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "not a link" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入以 http:// 或 https:// 开头的完整链接。");
    expect(mock.calls).toHaveLength(0);
  });

  it("posts the link in the body and hands back the new item", async () => {
    const mock = createFetchMock({ "POST /api/library/imports": () => json(itemRaw({ id: "l1", source: "link", status: "queued" })) });
    const onImported = vi.fn();
    renderWithProviders(<ImportForm linkImport onImported={onImported} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: " https://www.youtube.com/watch?v=x " } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "l1" })));
    expect(mock.calls[0].url.search).toBe("");
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ url: "https://www.youtube.com/watch?v=x" });
  });

  it("translates server refusals, and a 404 means the switch was turned off", async () => {
    let status = 400;
    const mock = createFetchMock({ "POST /api/library/imports": () => json({ error: status === 400 ? "Invalid URL" : "Not Found" }, status) });
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "http://10.0.0.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("链接无效或不允许访问。");
    status = 404;
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("管理员没有开启链接导入。"));
  });
});
