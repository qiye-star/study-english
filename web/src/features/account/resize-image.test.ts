import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarPickError, fitWithin, prepareAvatar } from "./resize-image";

class FakeImage {
  naturalWidth = 2000;
  naturalHeight = 1000;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_: string) {
    queueMicrotask(() => this.onload?.());
  }
}

class BrokenImage extends FakeImage {
  set src(_: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

function stubUrls() {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fitWithin", () => {
  it("keeps small images and scales the long side to the limit", () => {
    expect(fitWithin(300, 200, 1024)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(2000, 1000, 1024)).toEqual({ w: 1024, h: 512 });
    expect(fitWithin(600, 3000, 1024)).toEqual({ w: 205, h: 1024 });
  });
});

describe("prepareAvatar", () => {
  it("rejects a non-image file before decoding it", async () => {
    const file = new File(["GIF89a"], "a.gif", { type: "image/gif" });
    await expect(prepareAvatar(file)).rejects.toBeInstanceOf(AvatarPickError);
  });

  it("returns the original JPEG when the browser has no canvas (the server decides)", async () => {
    stubUrls();
    vi.stubGlobal("Image", FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const file = new File(["jpg"], "a.jpg", { type: "image/jpeg" });
    expect(await prepareAvatar(file)).toBe(file);
  });

  it("re-encodes to JPEG with the long side at most 1024", async () => {
    stubUrls();
    vi.stubGlobal("Image", FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    const sizes: { w: number; h: number; type: string }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      sizes.push({ w: this.width, h: this.height, type: type ?? "" });
      cb(new Blob(["out"], { type: "image/jpeg" }));
    });
    const out = await prepareAvatar(new File(["png"], "a.png", { type: "image/png" }));
    expect(out.type).toBe("image/jpeg");
    expect(sizes).toEqual([{ w: 1024, h: 512, type: "image/jpeg" }]);
  });

  it("paints an opaque white background before drawing, so transparent PNGs do not turn black", async () => {
    stubUrls();
    vi.stubGlobal("Image", FakeImage);
    const calls: string[] = [];
    const ctx = {
      set fillStyle(v: string) { calls.push(`fillStyle:${v}`); },
      fillRect: vi.fn(() => { calls.push("fillRect"); }),
      drawImage: vi.fn(() => { calls.push("drawImage"); }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob(["out"], { type: "image/jpeg" }));
    });
    await prepareAvatar(new File(["png"], "a.png", { type: "image/png" }));
    expect(calls).toEqual(["fillStyle:#ffffff", "fillRect", "drawImage"]);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 512);
  });

  it("rejects an image type the browser cannot decode (e.g. HEIC where canvas fails)", async () => {
    stubUrls();
    vi.stubGlobal("Image", BrokenImage);
    const file = new File(["heic"], "IMG_1.HEIC", { type: "image/heic" });
    await expect(prepareAvatar(file)).rejects.toBeInstanceOf(AvatarPickError);
  });
});
