import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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

describe("ImportForm polish (R-A13, R-A14)", () => {
  const withClipboard = (readText: () => Promise<string>) => {
    Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
  };
  const withoutClipboard = () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  };

  it("shows the DRM notice as an amber card and the disabled notice as a plain card", () => {
    const { unmount } = renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.getByTestId("library-drm-note").className).toMatch(/\blib-note--warn\b/);
    unmount();
    renderWithProviders(<ImportForm linkImport={false} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-link-disabled").className).toMatch(/\blib-note\b/);
    expect(screen.getByTestId("library-link-disabled")).toHaveAttribute("role", "status");
  });

  it("uses glass fields and the specular button", () => {
    withoutClipboard();
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.getByLabelText("视频页面链接").className).toMatch(/\blib-ffield-input\b/);
    expect(screen.getByLabelText("标题(可选)").className).toMatch(/\blib-ffield-input\b/);
    expect(screen.getByRole("button", { name: "导入" }).className).toMatch(/\blib-spec\b/);
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
  });

  it("hides the paste button when the clipboard cannot be read", () => {
    withoutClipboard();
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "粘贴" })).toBeNull();
  });

  it("pastes a trimmed link into the field and clears an old error", async () => {
    withClipboard(() => Promise.resolve("  https://www.youtube.com/watch?v=x \n"));
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "粘贴" }));
    });
    expect((screen.getByLabelText("视频页面链接") as HTMLInputElement).value).toBe("https://www.youtube.com/watch?v=x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays quiet and focuses the field when the paste is refused", async () => {
    withClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "粘贴" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("视频页面链接")).toHaveFocus();
  });

  it("shows the import as in progress while the request is pending, and an error as a red card", async () => {
    withoutClipboard();
    let release: (r: Response) => void = () => {};
    const mock = createFetchMock({
      "POST /api/library/imports": () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "http://10.0.0.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("button", { name: "导入中…" })).toBeDisabled();
    await act(async () => { release(json({ error: "Invalid URL" }, 400)); });
    const alert = await screen.findByRole("alert");
    expect(alert.className).toMatch(/\blib-note--err\b/);
    expect(screen.getByRole("button", { name: "导入" })).toBeEnabled();
  });
});
