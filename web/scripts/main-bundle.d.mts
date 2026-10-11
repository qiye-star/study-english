export function mainChunkFiles(html: string): string[];
export function gzipKb(buf: Uint8Array): number;
export function checkDelta(baseKb: number, nowKb: number, maxDeltaKb: number): { delta: number; ok: boolean };
