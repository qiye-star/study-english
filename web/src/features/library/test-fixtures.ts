/**
 * 服务端形状(snake_case)的样例,只给测试用;形状与 server/tests/fixtures/library_contract.json 一致
 * (类型键表由 library-contract.test.ts 对真实夹具核对)。产品代码不得导入本文件。
 */
export const FORMATS = ["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"];

export const CONFIG_RAW = {
  enabled: true,
  link_import: true,
  asr: true,
  ai: true,
  limits: {
    max_upload_mb: 500, max_duration_minutes: 90, quota_mb: 2000, used_bytes: 10 * 1024 * 1024,
    max_items: 100, chunk_bytes: 8388608, formats: FORMATS,
  },
};

export const CONFIG_OFF_RAW: Record<string, unknown> = { enabled: false, link_import: false, asr: false, ai: false, limits: null };

export function itemRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "i1", kind: "video", source: "upload", title: "Lecture 1", status: "ready", stage: null, progress: 100,
    error_kind: null, duration_ms: 125_000, seg_count: 3, library_bytes: 5 * 1024 * 1024, sub_source: "uploaded",
    resume_ms: 0, resume_idx: 0, rate_pct: 100, has_poster: true, low_confidence: false, created_at: "2026-10-13T08:00:00Z", last_opened_at: null, ...over,
  };
}

export const SEGMENTS_RAW: Record<string, unknown>[] = [
  { idx: 0, start_ms: 1000, end_ms: 3000, text: "Hello there.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null },
  { idx: 1, start_ms: 3200, end_ms: 6000, text: "How are you today?", zh: "你今天好吗?", zh_lang: "zh-CN", has_analysis: false, analysis_lang: null },
  { idx: 2, start_ms: 9000, end_ms: 11000, text: "I am fine, thanks.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null },
];

export function detailRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...itemRaw(), segments: SEGMENTS_RAW, ...over };
}
