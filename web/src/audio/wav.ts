export const ASSESSMENT_SAMPLE_RATE = 16000;

export interface WavInfo {
  format: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/** 单声道 16 位 PCM WAV(服务端 /api/speech/assessments 只接受这种格式)。 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i];
    const s = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buffer;
}

export function readWavInfo(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "durationMs"> | null = null;
  let dataBytes = -1;
  while (offset + 8 <= buffer.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (id === "data") {
      dataBytes = Math.min(size, buffer.byteLength - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes < 0) throw new Error("Not a WAV file");
  const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  return { ...fmt, dataBytes, durationMs: bytesPerSecond ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0 };
}
