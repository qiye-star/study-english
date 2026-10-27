import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Md5, md5Blob, md5Hex } from "./md5";

const enc = (s: string) => new TextEncoder().encode(s);

describe("md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"],
  ])("RFC 1321 vector for %j", (input, hex) => {
    expect(md5Hex(enc(input))).toBe(hex);
  });

  it("matches node:crypto across the 64-byte block and 56-byte padding boundaries", () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 127, 128]) {
      const data = randomBytes(n);
      expect(md5Hex(new Uint8Array(data))).toBe(createHash("md5").update(data).digest("hex"));
    }
  });

  it("incremental updates equal one-shot hashing, including splits that cut blocks", () => {
    const data = randomBytes(10_000);
    const h = new Md5();
    h.update(new Uint8Array(data.subarray(0, 1)));
    h.update(new Uint8Array(data.subarray(1, 77)));
    h.update(new Uint8Array(data.subarray(77)));
    expect(h.hex()).toBe(createHash("md5").update(data).digest("hex"));
  });

  it("md5Blob crosses 4 MiB chunk boundaries and reports monotonic progress", async () => {
    const size = 9 * 1024 * 1024 + 123;
    const data = new Uint8Array(size).map((_, i) => (i * 7 + (i >> 9)) & 0xff);
    const seen: number[] = [];
    const hex = await md5Blob(new Blob([data as BlobPart]), { onProgress: (n) => seen.push(n) });
    expect(hex).toBe(createHash("md5").update(data).digest("hex"));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(seen[seen.length - 1]).toBe(size);
  });

  it("md5Blob stops when the signal is aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(md5Blob(new Blob([new Uint8Array(10) as BlobPart]), { signal: ctrl.signal })).rejects.toThrow();
  });
});
