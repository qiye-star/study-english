import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ZipError, bytesOf, entryBlob, openZip, readSmallText } from "./zip-reader";
import { blobOf, buildZip, type TestEntry } from "./test-zip";

const all = () => true;
const text = (s: string) => new TextEncoder().encode(s);

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ZipError ? e.reason : `other:${String(e)}`;
  }
  return "ok";
}

describe("openZip", () => {
  it("lists accepted entries with their data offsets; entryBlob returns the exact bytes", async () => {
    const bytes = await buildZip([
      { name: "manifest.json", data: '{"a":1}' },
      { name: "items/0123456789abcdef0123456789abcdef/media.mp4", data: new Uint8Array([1, 2, 3, 4, 5]) },
    ]);
    const blob = blobOf(bytes);
    const entries = await openZip(blob, { accept: all });
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "items/0123456789abcdef0123456789abcdef/media.mp4"]);
    expect(entries[1]).toMatchObject({ method: 0, compressedSize: 5, size: 5 });
    expect(Array.from(await bytesOf(entryBlob(blob, entries[1])))).toEqual([1, 2, 3, 4, 5]);
    expect(await readSmallText(blob, entries[0], 1024)).toBe('{"a":1}');
  });

  it("finds the end record when the archive has a comment", async () => {
    const bytes = await buildZip([{ name: "a.txt", data: "hi" }], { comment: "hello comment" });
    const entries = await openZip(blobOf(bytes), { accept: all });
    expect(entries).toHaveLength(1);
  });

  it("reads ZIP64 central directories", async () => {
    const bytes = await buildZip([{ name: "a.txt", data: "zip64 body" }, { name: "b.txt", data: "two" }], { zip64: true });
    const blob = blobOf(bytes);
    const entries = await openZip(blob, { accept: all });
    expect(entries.map((e) => e.size)).toEqual([10, 3]);
    expect(await readSmallText(blob, entries[0], 100)).toBe("zip64 body");
  });

  it("reads DEFLATE text through DecompressionStream", async () => {
    const bytes = await buildZip([{ name: "meta.json", data: '{"v":1,"title":"deflated text"}', method: 8 }]);
    const blob = blobOf(bytes);
    const [e] = await openZip(blob, { accept: all });
    expect(e.method).toBe(8);
    expect(await readSmallText(blob, e, 1024)).toBe('{"v":1,"title":"deflated text"}');
  });

  it("rejects bytes that are not a zip", async () => {
    expect(await reasonOf(openZip(blobOf(text("not a zip at all, just text")), { accept: all }))).toBe("not_zip");
    expect(await reasonOf(openZip(blobOf(new Uint8Array(4)), { accept: all }))).toBe("not_zip");
  });

  it("rejects a truncated archive (central directory past the end)", async () => {
    const bytes = await buildZip([{ name: "a.txt", data: "abcdefgh" }]);
    const cut = bytes.slice(0, bytes.length - 40);
    expect(await reasonOf(openZip(blobOf(cut), { accept: all }))).toMatch(/not_zip|truncated/);
  });

  it("rejects encrypted entries and unsupported methods", async () => {
    expect(await reasonOf(openZip(blobOf(await buildZip([{ name: "a.txt", data: "x", flags: 1 }])), { accept: all }))).toBe("encrypted");
    expect(await reasonOf(openZip(blobOf(await buildZip([{ name: "a.txt", data: "x", method: 12 }])), { accept: all }))).toBe("unsupported_method");
  });

  it("rejects multi-disk archives", async () => {
    expect(await reasonOf(openZip(blobOf(await buildZip([{ name: "a.txt", data: "x" }], { diskNumber: 1 })), { accept: all }))).toBe("multi_disk");
  });

  it("enforces the entry-count and central-directory size limits", async () => {
    const bytes = await buildZip([{ name: "a.txt", data: "x" }, { name: "b.txt", data: "y" }]);
    expect(await reasonOf(openZip(blobOf(bytes), { accept: all, maxEntries: 1 }))).toBe("too_many_entries");
    expect(await reasonOf(openZip(blobOf(bytes), { accept: all, maxDirectoryBytes: 10 }))).toBe("directory_too_large");
  });

  it.each([
    ["../evil.txt"],
    ["items/../x"],
    ["a\\b.txt"],
    ["/abs.txt"],
    ["C:/win.txt"],
    ["bad\u0000nul.txt"],
  ])("rejects unsafe name %j even when the name is not accepted", async (name) => {
    const bytes = await buildZip([{ name, data: "x" }]);
    expect(await reasonOf(openZip(blobOf(bytes), { accept: () => false }))).toBe("bad_name");
  });

  it("rejects duplicate names among accepted entries", async () => {
    const bytes = await buildZip([{ name: "manifest.json", data: "1" }, { name: "manifest.json", data: "2" }]);
    expect(await reasonOf(openZip(blobOf(bytes), { accept: all }))).toBe("duplicate");
  });

  it("rejects overlapping entries (zip-bomb shape) and data running past the central directory", async () => {
    const a: TestEntry = { name: "a.bin", data: new Uint8Array(100) };
    const b: TestEntry = { name: "b.bin", data: new Uint8Array(100), localOffset: 0 };
    expect(await reasonOf(openZip(blobOf(await buildZip([a, b])), { accept: all }))).toBe("overlap");
  });

  it("does not read local headers of entries the filter does not accept", async () => {
    const bytes = await buildZip([{ name: "other.txt", data: "x" }, { name: "keep.txt", data: "y" }]);
    const blob = blobOf(bytes);
    const spy = vi.spyOn(blob, "slice");
    const entries = await openZip(blob, { accept: (n) => n === "keep.txt" });
    expect(entries.map((e) => e.name)).toEqual(["keep.txt"]);
    const offsets = spy.mock.calls.map((c) => c[0]);
    // 只有 EOCD 尾部、中央目录和 keep.txt 的本地头被读取
    expect(offsets.length).toBeLessThanOrEqual(3);
  });

  it("reads only the tail, the central directory and a 30-byte header per accepted entry (no whole-file read)", async () => {
    // 一个 20 MiB 的媒体条目 + 一个小 manifest;只接受 manifest 时,媒体的字节不能被读取
    const bytes = await buildZip([
      { name: "items/0123456789abcdef0123456789abcdef/media.mp4", data: new Uint8Array(20 * 1024 * 1024) },
      { name: "manifest.json", data: "{}" },
    ]);
    const big = blobOf(bytes);
    let read = 0;
    const origSlice = big.slice.bind(big);
    vi.spyOn(big, "slice").mockImplementation((s?: number, e?: number) => {
      const part = origSlice(s, e);
      read += part.size;
      return part;
    });
    const entries = await openZip(big, { accept: (n) => n === "manifest.json" });
    expect(entries.map((e) => e.name)).toEqual(["manifest.json"]);
    expect(read).toBeLessThan(64 * 1024 + 4096);
  });

  it("refuses DEFLATE text when DecompressionStream is unavailable", async () => {
    const blob = blobOf(await buildZip([{ name: "meta.json", data: "{}", method: 8 }]));
    const [e] = await openZip(blob, { accept: all });
    const saved = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
    (globalThis as { DecompressionStream?: unknown }).DecompressionStream = undefined;
    try {
      expect(await reasonOf(readSmallText(blob, e, 1024))).toBe("deflate_unsupported");
    } finally {
      (globalThis as { DecompressionStream?: unknown }).DecompressionStream = saved;
    }
  });

  it("stops a DEFLATE bomb once the decompressed size exceeds the cap", async () => {
    const big = new Uint8Array(1024 * 1024); // 1 MiB 的零,压缩后很小
    const blob = blobOf(await buildZip([{ name: "meta.json", data: big, method: 8 }]));
    const [e] = await openZip(blob, { accept: all });
    expect(e.compressedSize).toBeLessThan(10_000);
    // 声明大小 1 MiB,上限 1 KiB:先按声明大小拦
    expect(await reasonOf(readSmallText(blob, e, 1024))).toBe("too_large");
  });

  it("rejects a DEFLATE entry whose real size exceeds the declared size", async () => {
    const big = new Uint8Array(64 * 1024);
    const blob = blobOf(await buildZip([{ name: "meta.json", data: big, method: 8, declaredSize: 10 }]));
    const [e] = await openZip(blob, { accept: all });
    expect(e.size).toBe(10);
    expect(await reasonOf(readSmallText(blob, e, 1024))).toBe("malformed");
  });

  it("the sha of an accepted STORE entry matches the original bytes", async () => {
    const payload = new Uint8Array(300_000).map((_, i) => (i * 31) & 0xff);
    const blob = blobOf(await buildZip([{ name: "items/0123456789abcdef0123456789abcdef/media.mp4", data: payload }]));
    const [e] = await openZip(blob, { accept: all });
    const got = await bytesOf(entryBlob(blob, e));
    expect(createHash("md5").update(got).digest("hex")).toBe(createHash("md5").update(payload).digest("hex"));
  });
});
