import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** 四周留白(QR 规范的静区)= 4 个模块。 */
const QUIET = 4;

/** 文本 → 模块矩阵 → 一条 SVG path(每个深色模块一个 1×1 方块)。数据过长等异常返回 null。 */
export function qrPath(text: string): { size: number; d: string } | null {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
    return { size: n + QUIET * 2, d };
  } catch {
    return null;
  }
}

/**
 * 二维码(spec §3.4 / §6.3):在本地用 qrcode-generator 生成,不发网络请求;单个 `<svg role="img">`,
 * 深色模块用 currentColor,白底并留 4 个模块的静区(深色模式下也保持白底,扫码才可靠)。
 */
export function QrCode({ text, size, label = "QR code" }: { text: string; size: number; label?: string }) {
  const qr = useMemo(() => qrPath(text), [text]);
  if (!qr) return null;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.d} fill="currentColor" />
    </svg>
  );
}
