import { describe, expect, it, vi } from "vitest";
import { inviteLink, readInviteFragment, shareInviteLink } from "./invite-link";

describe("inviteLink (X27: the code travels only in the # fragment)", () => {
  it("builds /register#invite=CODE with no query string", () => {
    const link = inviteLink("https://learn.example", "ABCDE-FGHJK");
    expect(link).toBe("https://learn.example/register#invite=ABCDE-FGHJK");
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(url.hash).toBe("#invite=ABCDE-FGHJK");
  });
});

describe("readInviteFragment", () => {
  it("normalises a valid fragment to upper case", () => {
    expect(readInviteFragment("#invite=abcde-fghjk")).toBe("ABCDE-FGHJK");
  });

  it("ignores other fragments and missing values", () => {
    expect(readInviteFragment("")).toBeNull();
    expect(readInviteFragment("#other=ABCDE-FGHJK")).toBeNull();
    expect(readInviteFragment("#invite=")).toBeNull();
  });

  it("rejects characters outside the code alphabet", () => {
    expect(readInviteFragment("#invite=abc<script>")).toBeNull();
    expect(readInviteFragment("#invite=ABCDE FGHJK")).toBeNull();
    expect(readInviteFragment("#invite=../../x")).toBeNull();
  });

  it("rejects overlong values", () => {
    expect(readInviteFragment(`#invite=${"A".repeat(200)}`)).toBeNull();
  });
});

describe("shareInviteLink", () => {
  const link = "https://learn.example/register#invite=ABCDE-FGHJK";

  it("uses the native share sheet when available and reports shared", async () => {
    const share = vi.fn(async (_data: { title: string; text: string; url: string }) => undefined);
    const writeText = vi.fn(async () => undefined);
    const result = await shareInviteLink(link, { share, clipboard: { writeText } });
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(payload.url).toBe(link);
    expect(payload.text).not.toMatch(/@|username/i);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reports cancelled when the user dismisses the share sheet", async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); });
    const writeText = vi.fn(async () => undefined);
    expect(await shareInviteLink(link, { share, clipboard: { writeText } })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when sharing is unavailable", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await shareInviteLink(link, { clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(link);
  });

  it("reports failed instead of throwing when the clipboard refuses", async () => {
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    expect(await shareInviteLink(link, { clipboard: { writeText } })).toBe("failed");
  });

  it("reports failed when there is no clipboard at all", async () => {
    expect(await shareInviteLink(link, {})).toBe("failed");
  });
});
