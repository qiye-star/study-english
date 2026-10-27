import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as session from "../../api/session";
import * as api from "./api";
import type { CatalogState } from "./api";
import { PackageDialog } from "./package-dialog";
import { makePackageFile } from "./package-fixture";
import { S } from "./strings";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  checkPackage: vi.fn(),
  startUpload: vi.fn(),
  startReplace: vi.fn(),
  putChunk: vi.fn(),
  putSubtitles: vi.fn(),
  completeUpload: vi.fn(),
  cancel: vi.fn(),
  fetchCatalog: vi.fn(),
}));

const A = "0123456789abcdef0123456789abcdef";
const B = "1123456789abcdef0123456789abcdef";
const C = "2123456789abcdef0123456789abcdef";
const ID = (n: number) => `3f2a9c1e-0000-4000-8000-00000000000${n}`;
const STATE: CatalogState = {
  enabled: true, available: true, asr: true, ai: true, link: true, proxyConfigured: false, aiDaily: 300, aiToday: 4,
  languages: ["zh-CN", "ja-JP"], levels: ["A1", "B1"], chunkBytes: 8388608, maxUploadMb: 500, formats: ["mp4"],
};

function match(md5: string, over: Partial<api.PackageMatch> = {}): api.PackageMatch {
  return {
    sourceMd5: md5, catalogId: ID(1), title: "old", status: "ready", published: false, retired: false, segCount: 5,
    durationMs: 61000, mediaMissing: false, refs: 0, uploadReceived: 0, uploadTotal: 0, ...over,
  };
}

function setup(state: CatalogState = STATE, props: Partial<{ onClose: () => void; onDone: () => void }> = {}) {
  session.setSession({
    username: "op", role: "operator", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
  const onClose = props.onClose ?? vi.fn();
  const onDone = props.onDone ?? vi.fn();
  render(<PackageDialog open state={state} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

async function pickFile(file: File) {
  await userEvent.upload(screen.getByLabelText(S.package.pick), file);
}

afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

describe("PackageDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.checkPackage).mockResolvedValue([]);
    vi.mocked(api.startUpload).mockResolvedValue({ catalogId: ID(1), chunkBytes: 8388608 });
    vi.mocked(api.startReplace).mockResolvedValue({ catalogId: ID(1), chunkBytes: 8388608 });
    vi.mocked(api.putChunk).mockResolvedValue({ catalogId: ID(1), status: "uploading", uploadReceived: 1, uploadTotal: 1, chunkBytes: 8388608 });
    vi.mocked(api.putSubtitles).mockResolvedValue({ cueCount: 1 });
    vi.mocked(api.completeUpload).mockResolvedValue({ id: ID(1) } as api.CatalogRow);
    vi.mocked(api.cancel).mockResolvedValue({ id: ID(1) } as api.CatalogRow);
  });

  it("previews totals, categories and the default selection; the batch form has no title", async () => {
    setup();
    vi.mocked(api.checkPackage).mockResolvedValue([match(C, { sourceMd5: C, published: true, title: "Published one" })]);
    await pickFile(await makePackageFile([
      { md5: A, title: "Talk A" },
      { md5: B, title: "Talk B", language: "zh-CN" },
      { md5: C, title: "Talk C" },
    ]));
    expect(await screen.findByText(/^共 3 个/)).toBeInTheDocument();
    expect(screen.getByText(S.package.counts({ new: 2, exists: 0, published: 1, resumable: 0, busy: 0, skip_local: 0 }))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Talk A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Talk B" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Talk C" })).toBeDisabled();
    expect(screen.getByText(S.package.nonEnglish)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(S.form.titleHint)).not.toBeInTheDocument();
    expect(screen.getByLabelText(S.form.aiLang)).toHaveValue("zh-CN");
    expect(api.checkPackage).toHaveBeenCalledWith([A, B, C]);
    expect(screen.getByRole("button", { name: S.package.start(1) })).toBeEnabled();
  });

  it("defaults to skip; overwrite makes existing unpublished items selectable and keeps published ones disabled", async () => {
    setup();
    vi.mocked(api.checkPackage).mockResolvedValue([match(A), match(C, { sourceMd5: C, published: true })]);
    await pickFile(await makePackageFile([{ md5: A, title: "Talk A" }, { md5: B, title: "Talk B", language: "en-US" }, { md5: C, title: "Talk C" }]));
    expect(await screen.findByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByLabelText(S.package.modeSkip)).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Talk A" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Talk A" })).toBeDisabled();
    expect(screen.queryByText(S.package.overwriteNote)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(S.package.modeOverwrite));
    expect(screen.getByText(S.package.overwriteNote)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Talk A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Talk A" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Talk C" })).toBeDisabled();
    expect(screen.getByText("已发布:先下架才能覆盖")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: S.package.start(2) })).toBeEnabled();
  });

  it("runs the batch: a single failure is listed with its Chinese reason and the rest still finish", async () => {
    const { onDone } = setup();
    vi.mocked(api.startUpload).mockImplementation(async (_f, _s, _m, md5) => {
      if (md5 === C) throw new ApiError(400, "Unsupported file type");
      return { catalogId: ID(1), chunkBytes: 8388608 };
    });
    await pickFile(await makePackageFile([{ md5: A, title: "Talk A" }, { md5: C, title: "Talk C" }]));
    await userEvent.click(await screen.findByRole("button", { name: S.package.start(2) }));
    expect(await screen.findByText(S.package.summaryTitle)).toBeInTheDocument();
    expect(screen.getByText(/Talk C:.*不支持的文件类型/)).toBeInTheDocument();
    expect(api.startUpload).toHaveBeenCalledWith("media.mp4", expect.any(Number), expect.objectContaining({ title: "Talk A" }), A);
    expect(api.completeUpload).toHaveBeenCalledWith(ID(1));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("while running, Escape and the backdrop do not close it and a leave-page warning is armed", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const { onClose } = setup();
    vi.mocked(api.putChunk).mockReturnValue(new Promise(() => {}));
    await pickFile(await makePackageFile([{ md5: A, title: "Talk A" }]));
    await userEvent.click(await screen.findByRole("button", { name: S.package.start(1) }));
    expect(await screen.findByText(S.package.running)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(add.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
    expect(screen.getByRole("button", { name: S.package.stop })).toBeInTheDocument();
  });

  it("a broken package shows the fixed message and makes no API call", async () => {
    setup();
    await pickFile(new File([new TextEncoder().encode("this is not a zip") as BlobPart], "bad.zip", { type: "application/zip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(S.package.reasons.not_package);
    expect(api.checkPackage).not.toHaveBeenCalled();
    expect(api.startUpload).not.toHaveBeenCalled();
  });

  it("when media tools are unavailable the start button is disabled", async () => {
    setup({ ...STATE, available: false });
    await pickFile(await makePackageFile([{ md5: A, title: "Talk A" }]));
    expect(await screen.findByRole("button", { name: S.package.start(1) })).toBeDisabled();
    expect(screen.getByText(S.package.unavailable)).toBeInTheDocument();
  });
});
