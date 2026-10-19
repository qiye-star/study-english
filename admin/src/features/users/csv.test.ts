import { describe, expect, it, vi } from "vitest";
import { buildInviteCsv, downloadCsv } from "./csv";

describe("buildInviteCsv", () => {
  it("writes a BOM and the three columns code,label,expires_at", () => {
    const text = buildInviteCsv([{ code: "ABCDE-FGHJK", label: "三年二班", expiresAt: "2026-12-01T00:00:00Z" }]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split("\n")).toEqual(["code,label,expires_at", "ABCDE-FGHJK,三年二班,2026-12-01T00:00:00Z", ""]);
  });

  it("leaves expires_at empty for a code that never expires", () => {
    const text = buildInviteCsv([{ code: "ABCDE-FGHJK", label: "", expiresAt: null }]);
    expect(text.slice(1).split("\n")[1]).toBe("ABCDE-FGHJK,,");
  });

  it("quotes cells with commas, quotes or line breaks", () => {
    const text = buildInviteCsv([{ code: "ABCDE-FGHJK", label: 'a, "b"\nc', expiresAt: null }]);
    expect(text).toContain('ABCDE-FGHJK,"a, ""b""\nc",');
  });

  it("neutralises spreadsheet formulas in labels with a leading apostrophe", () => {
    const labels = ["=HYPERLINK(\"x\")", "+1", "-2", "@sum", "\tpad", "\rpad"];
    const rows = labels.map((label) => ({ code: "ABCDE-FGHJK", label, expiresAt: null }));
    const body = buildInviteCsv(rows).slice(1).split(/\r?\n/).slice(1);
    expect(body[0]).toContain(",\"'=HYPERLINK(\"\"x\"\")\",");
    expect(body[1].split(",")[1]).toBe("'+1");
    expect(body[2].split(",")[1]).toBe("'-2");
    expect(body[3].split(",")[1]).toBe("'@sum");
  });

  it("never adds the codes to any URL-like field (codes are plain cells only)", () => {
    const text = buildInviteCsv([{ code: "ABCDE-FGHJK", label: "x", expiresAt: null }]);
    expect(text).not.toMatch(/https?:|\?/);
  });
});

describe("downloadCsv", () => {
  it("hands the text to a Blob URL, clicks a download link and releases the URL", () => {
    const createObjectURL = vi.fn(() => "blob:invites-1");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadCsv("invite-codes.csv", "code,label,expires_at\n");

    const blob = (createObjectURL.mock.calls as unknown as Array<[Blob]>)[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:invites-1");
    click.mockRestore();
  });
});
