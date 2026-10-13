import type { ApiClient } from "~/api/client";
import type { Paged } from "~/api/types";

export interface AssessmentScores {
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
}

export interface AssessmentResult extends AssessmentScores {
  detailResult: { display: string; words: PronunciationAssessmentWordResultType[] };
}

export interface AssessResponse extends AssessmentResult {
  assessmentId?: string;
}

export interface AssessmentSummary {
  id: string;
  referenceText: string;
  language: string;
  durationMs: number;
  scores: AssessmentScores;
  createdAt: string;
}

export interface AssessmentDetail extends AssessmentSummary {
  result: AssessmentResult;
}

/** 保存评测时的来源;服务端 routers/speech.py 的 SOURCES 必须同时含有它(library:跟读库,spec 2026-10-13-video-import §9)。 */
export type AssessmentSource = "practice" | "chat" | "library";

export const ASSESSMENT_TIMEOUT_MS = 330_000;

export const PRACTICE_SERVER_ERRORS: Record<string, string> = {
  "Reference text is required": "web.practice.errors.referenceRequired",
  "Reference text is too long": "web.practice.errors.referenceTooLong",
  "Audio is too long": "web.practice.errors.audioTooLong",
  "Audio must be a 16 kHz mono 16-bit WAV": "web.practice.errors.badAudio",
  "Unsupported language": "web.practice.errors.language",
  "Pronunciation assessment is not configured": "web.practice.errors.notConfigured",
  "Recording storage quota exceeded": "web.practice.errors.quota",
  "Upstream unavailable": "web.practice.errors.upstream",
  "Assessment not found": "web.practice.errors.notFound",
  "Could not save the recording": "web.practice.errors.saveFailed",
};

const path = (id: string) => `/api/assessments/${encodeURIComponent(id)}`;

export function assessPronunciation(
  api: ApiClient,
  params: { wav: Blob; reference: string; language: string; save: boolean; source?: AssessmentSource; signal?: AbortSignal },
): Promise<AssessResponse> {
  const form = new FormData();
  form.append("file", new File([params.wav], "recording.wav", { type: "audio/wav" }));
  form.append("reference", params.reference);
  form.append("language", params.language);
  if (params.save) {
    form.append("save", "true");
    if (params.source) form.append("source", params.source);
  }
  return api.request("POST", "/api/speech/assessments", { form, timeoutMs: ASSESSMENT_TIMEOUT_MS, signal: params.signal });
}

export function listAssessments(api: ApiClient, page = 1, perPage = 20): Promise<Paged<"assessments", AssessmentSummary>> {
  return api.request("GET", "/api/assessments", { query: { page, per_page: perPage } });
}

export function getAssessment(api: ApiClient, id: string): Promise<AssessmentDetail> {
  return api.request("GET", path(id));
}

export function getAssessmentAudio(api: ApiClient, id: string): Promise<Blob> {
  return api.request("GET", `${path(id)}/audio`, { as: "blob" });
}

export function deleteAssessment(api: ApiClient, id: string): Promise<{ id: string }> {
  return api.request("DELETE", path(id));
}

export interface AssessmentWordBrief {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
}

/** 逐词结果的精简形式(与服务端 message_out.assessment.words 同形),用于徽标与转写高亮。 */
export function briefWords(words: PronunciationAssessmentWordResultType[] | undefined): AssessmentWordBrief[] {
  return (words ?? []).map((w) => {
    const pa = (w as { pronunciationAssessment?: { accuracyScore?: number; errorType?: string } }).pronunciationAssessment;
    return { word: String((w as { word?: string }).word ?? ""), accuracyScore: pa?.accuracyScore ?? null, errorType: pa?.errorType ?? null };
  });
}
