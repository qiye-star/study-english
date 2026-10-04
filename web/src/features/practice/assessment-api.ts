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
};

const path = (id: string) => `/api/assessments/${encodeURIComponent(id)}`;

export function assessPronunciation(
  api: ApiClient,
  params: { wav: Blob; reference: string; language: string; save: boolean },
): Promise<AssessResponse> {
  const form = new FormData();
  form.append("file", new File([params.wav], "recording.wav", { type: "audio/wav" }));
  form.append("reference", params.reference);
  form.append("language", params.language);
  if (params.save) form.append("save", "true");
  return api.request("POST", "/api/speech/assessments", { form, timeoutMs: ASSESSMENT_TIMEOUT_MS });
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
