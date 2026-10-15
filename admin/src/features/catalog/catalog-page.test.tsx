import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { formatBytes } from "../../lib/format";
import * as api from "./api";
import { CatalogPage } from "./catalog-page";
import { S } from "./strings";

/** 与 features/library/library-page.test.tsx 的 signIn 相同 */
function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}
afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchCatalog: vi.fn(), importLink: vi.fn(), publish: vi.fn(), unpublish: vi.fn() }));

const ROW: api.CatalogRow = {
  id: "3f2a9c1e-0000-4000-8000-000000000001", title: "Talk one", level: "B1", tags: ["news"], licenseNote: "VOA",
  source: "upload", sourceHost: null, status: "ready", stage: null, progress: 100, errorKind: null, durationMs: 61000,
  segCount: 12, translated: 12, subSource: "uploaded", lowConfidence: false, kind: "audio", mediaBytes: 500000, hasPoster: true,
  mediaMissing: false, aiLang: "zh-CN", published: false, publishedAt: null, retired: false, refs: 0,
  uploadReceived: 0, uploadTotal: 0, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
};
const STATE: api.CatalogState = {
  enabled: true, available: true, asr: true, ai: true, link: true, proxyConfigured: false, aiDaily: 300, aiToday: 4,
  languages: ["zh-CN", "ja-JP"], levels: ["A1", "A2", "B1", "B2", "C1", "C2"], chunkBytes: 8388608, maxUploadMb: 500, formats: ["mp4", "mp3"],
};

function setup(role: session.Role = "operator", rows = [ROW]) {
  signIn(role);
  vi.mocked(api.fetchCatalog).mockResolvedValue({ items: rows, state: STATE });
  return render(<MemoryRouter><CatalogPage /></MemoryRouter>);
}

describe("CatalogPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the state, the backup note and the rows", async () => {
    setup();
    expect(await screen.findByText("Talk one")).toBeInTheDocument();
    expect(screen.getByText(S.backup)).toBeInTheDocument();
    expect(screen.getByText(S.state.shared("4", "300"))).toBeInTheDocument();
  });

  it("shows the media kind and size", async () => {
    setup("viewer", [{ ...ROW, kind: "video" }]);
    expect(await screen.findByText(`${S.kind.video} · ${formatBytes(500000)}`)).toBeInTheDocument();
  });

  it("publishes a ready row from the toggle", async () => {
    vi.mocked(api.publish).mockResolvedValue({ ...ROW, published: true });
    setup();
    const row = (await screen.findByText("Talk one")).closest("tr")!;
    await userEvent.click(within(row).getByRole("switch", { name: S.cols.published }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(ROW.id));
  });

  it("imports a link with metadata", async () => {
    vi.mocked(api.importLink).mockResolvedValue({ ...ROW, status: "queued" });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: S.actions.importLink }));
    await userEvent.type(screen.getByLabelText(S.form.url), "https://learningenglish.voanews.com/a/1.html");
    await userEvent.type(screen.getByLabelText(S.form.license), "VOA");
    await userEvent.click(screen.getByRole("button", { name: S.form.submit }));
    await waitFor(() => expect(api.importLink).toHaveBeenCalledWith("https://learningenglish.voanews.com/a/1.html",
      expect.objectContaining({ licenseNote: "VOA", aiLang: "zh-CN" })));
  });

  it("hides write actions from viewers", async () => {
    setup("viewer");
    await screen.findByText("Talk one");
    expect(screen.queryByRole("button", { name: S.actions.importLink })).toBeNull();
  });

  it("shows failed rows with a readable reason and stage text while processing", async () => {
    setup("operator", [{ ...ROW, id: "a".repeat(8) + ROW.id.slice(8), status: "failed", errorKind: "no_subtitles" },
                       { ...ROW, title: "Busy", status: "processing", stage: "translate", progress: 90 }]);
    expect(await screen.findByText(S.errorKinds.no_subtitles)).toBeInTheDocument();
    expect(screen.getByText(/翻译/)).toBeInTheDocument();
  });
});
