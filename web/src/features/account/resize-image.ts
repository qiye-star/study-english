/**
 * 选图后在浏览器里缩放(R-V9):长边 ≤ 1024,导出 JPEG 0.9。大图与 iOS 的 HEIC 经浏览器解码后变成 JPEG。
 * 只接受 JPEG / PNG / WebP 与浏览器能解码的图片;其他一律 AvatarPickError("unsupported")(界面显示本地文案,不回显文件名)。
 * canvas 不可用或缩放失败时,已知的 JPEG / PNG / WebP 原样返回,由服务端判定。
 */
export class AvatarPickError extends Error {
  constructor(public readonly code: "unsupported") {
    super(code);
    this.name = "AvatarPickError";
  }
}

export const AVATAR_MAX_SIDE = 1024;
const JPEG_QUALITY = 0.9;
const KNOWN_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** 等比缩到长边不超过 max(小图原样)。 */
export function fitWithin(w: number, h: number, max: number = AVATAR_MAX_SIDE): { w: number; h: number } {
  const side = Math.max(w, h);
  if (side <= max) return { w, h };
  const k = max / side;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new AvatarPickError("unsupported")); };
    img.src = url;
  });
}

export async function prepareAvatar(file: File): Promise<Blob> {
  const known = KNOWN_TYPES.has(file.type);
  if (!known && file.type && !file.type.startsWith("image/")) throw new AvatarPickError("unsupported");
  // 不认识的类型(HEIC 等)必须能被浏览器解码才能继续;解不了就报错。
  const fallback = (): Blob => {
    if (known) return file;
    throw new AvatarPickError("unsupported");
  };
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return fallback();
  }
  const { w, h } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback();
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return blob ?? fallback();
}
