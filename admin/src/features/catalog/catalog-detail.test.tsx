import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { CatalogDetail } from "./catalog-detail";
import { S } from "./strings";

beforeEach(() => session.setSession({
  username: "op", role: "operator", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
  totpEnabled: false, safeMode: false, maintenanceMode: "off",
}));
afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchCatalogItem: vi.fn(), patchSegment: vi.fn(), deleteItem: vi.fn(), translateMissing: vi.fn() }));

const ID = "3f2a9c1e-0000-4000-8000-000000000001";
const ITEM = { id: ID, title: "Talk", level: "B1", tags: [], licenseNote: null, source: "upload", sourceHost: null, status: "ready",
  stage: null, progress: 100, errorKind: null, durationMs: 6000, segCount: 2, translated: 1, subSource: "uploaded", lowConfidence: false, kind: "audio",
  mediaBytes: 1, hasPoster: false, mediaMissing: false, aiLang: "zh-CN", published: false, publishedAt: null, retired: false, refs: 2,
  uploadReceived: 0, uploadTotal: 0, createdAt: "", updatedAt: "" } as api.CatalogRow;
const SEGS: api.CatalogSegment[] = [
  { idx: 0, startMs: 500, endMs: 3000, text: "Hello there.", zh: "你好。", zhLang: "zh-CN", hasAnalysis: false, flags: [] },
  { idx: 1, startMs: 3200, endMs: 6000, text: "How are you?", zh: null, zhLang: null, hasAnalysis: false, flags: [] },
];

describe("CatalogDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: ITEM, segments: SEGS });
  });

  it("plays the media through the admin route and lists sentences with translations", async () => {
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("Hello there.")).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe(api.mediaUrl(ID));
    expect(screen.getByRole("option", { name: "B1 · 中级(能应对大多数日常场景)" })).toHaveAttribute("value", "B1");
  });

  it("edits a sentence while unpublished", async () => {
    vi.mocked(api.patchSegment).mockResolvedValue({ ...SEGS[1], zh: "你好吗?", zhLang: "zh-CN" });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("How are you?");
    await userEvent.click(screen.getAllByRole("button", { name: S.detail.edit })[1]);
    await userEvent.type(screen.getByLabelText("译文"), "你好吗?");
    await userEvent.click(screen.getByRole("button", { name: S.detail.save }));
    await waitFor(() => expect(api.patchSegment).toHaveBeenCalledWith(ID, 1, expect.objectContaining({ zh: "你好吗?" })));
  });

  it("locks sentence edits once published", async () => {
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: { ...ITEM, published: true }, segments: SEGS });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(S.detail.editLocked)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: S.detail.edit })).toBeNull();
  });

  it("explains retirement before deleting an item that learners added", async () => {
    vi.mocked(api.deleteItem).mockResolvedValue({ id: ID, outcome: "retired", refs: 2 });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.detail.del }));
    expect(screen.getByText(S.confirm.deleteBody(2))).toBeInTheDocument();
  });

  it("offers translate-missing when some sentences lack a translation", async () => {
    vi.mocked(api.translateMissing).mockResolvedValue({ ...ITEM, status: "queued" });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.detail.translate }));
    await waitFor(() => expect(api.translateMissing).toHaveBeenCalledWith(ID));
  });

  it("offers force delete only to superadmins", async () => {
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Hello there.");
    expect(screen.queryByRole("button", { name: S.detail.purge })).toBeNull();
    cleanup();
    session.setSession({
      username: "root", role: "superadmin", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
      totpEnabled: false, safeMode: false, maintenanceMode: "off",
    });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: S.detail.purge })).toBeInTheDocument();
  });
});
