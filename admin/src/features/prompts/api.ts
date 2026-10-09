import { request } from "../../api/client";

/* /api/admin/prompts*(server/app/routers/admin_prompts.py)。只放网络调用与类型;测试整体 mock 本文件(P-7)。 */

export type PromptKind = "text" | "json";

export interface PromptSpec {
  key: string;
  label: string;
  kind: PromptKind;
  required: string[];
  /** 可选占位符(服务端 PromptSpec.optional);缺省视为空 */
  optional?: string[];
  boundaries: string[];
  maxChars: number;
  /** false = 不做 format(语法规则);缺省视为 true */
  formatted?: boolean;
  /** 试运行表单的输入项;缺省用 required */
  sampleFields?: string[];
}

export interface PromptSummary {
  key: string;
  label: string;
  kind: PromptKind;
  publishedVersion: number | null;
  publishedAt: string | null;
  hasDraft: boolean;
}

export interface PromptDraft {
  body: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PromptVersion {
  version: number;
  status: "published" | "archived";
  note: string;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}

export interface PromptDetail {
  spec: PromptSpec;
  published: { version: number; body: string } | null;
  draft: PromptDraft | null;
  versions: PromptVersion[];
  /** 未发布任何版本时线上使用的正文(环境/内置/静态文件);未知时为 null */
  defaultBody: string | null;
}

export interface TestResult {
  output: string;
  ms: number;
}

/* ---- 服务端原始形状(snake_case) ---- */
interface RawSpec {
  key: string;
  label: string;
  kind: PromptKind;
  required: string[];
  optional?: string[];
  boundaries: string[];
  max_chars: number;
  formatted: boolean;
  sample_fields: string[];
}
interface RawDraft {
  body: string;
  note: string;
  updated_by: string;
  updated_at: string;
}
interface RawVersion {
  version: number;
  status: "published" | "archived";
  note: string;
  created_by: string;
  created_at: string;
  published_by: string | null;
  published_at: string | null;
}
interface RawSummary {
  key: string;
  label: string;
  kind: PromptKind;
  published_version: number | null;
  published_at: string | null;
  has_draft: boolean;
}
interface RawDetail {
  spec: RawSpec;
  published: { version: number; body: string } | null;
  draft: RawDraft | null;
  versions: RawVersion[];
  default_body: string | null;
}

const path = (key: string, rest = "") => `/api/admin/prompts/${encodeURIComponent(key)}${rest}`;

const toDraft = (d: RawDraft): PromptDraft => ({ body: d.body, note: d.note, updatedBy: d.updated_by, updatedAt: d.updated_at });

export async function listPrompts(): Promise<PromptSummary[]> {
  const rows = await request<RawSummary[]>("/api/admin/prompts");
  return rows.map((r) => ({
    key: r.key, label: r.label, kind: r.kind, publishedVersion: r.published_version, publishedAt: r.published_at, hasDraft: r.has_draft,
  }));
}

export async function getPrompt(key: string): Promise<PromptDetail> {
  const d = await request<RawDetail>(path(key));
  return {
    spec: {
      key: d.spec.key, label: d.spec.label, kind: d.spec.kind, required: d.spec.required, optional: d.spec.optional ?? [],
      boundaries: d.spec.boundaries,
      maxChars: d.spec.max_chars, formatted: d.spec.formatted, sampleFields: d.spec.sample_fields,
    },
    published: d.published,
    draft: d.draft ? toDraft(d.draft) : null,
    versions: d.versions.map((v) => ({
      version: v.version, status: v.status, note: v.note, createdBy: v.created_by, createdAt: v.created_at,
      publishedBy: v.published_by, publishedAt: v.published_at,
    })),
    defaultBody: d.default_body,
  };
}

export async function createPromptDraft(key: string, fromVersion?: number): Promise<PromptDraft> {
  return toDraft(await request<RawDraft>(path(key, "/draft"), { method: "POST", json: { from_version: fromVersion ?? null } }));
}

export async function savePromptDraft(key: string, body: string, note: string): Promise<PromptDraft> {
  return toDraft(await request<RawDraft>(path(key, "/draft"), { method: "PUT", json: { body, note } }));
}

export async function deletePromptDraft(key: string): Promise<void> {
  await request(path(key, "/draft"), { method: "DELETE", as: "none" });
}

export async function publishPrompt(key: string, reason: string): Promise<{ version: number }> {
  return request<{ version: number }>(path(key, "/draft/publish"), { method: "POST", json: { reason } });
}

export async function testPrompt(key: string, body: string, sample: Record<string, string>): Promise<TestResult> {
  return request<TestResult>(path(key, "/test"), { method: "POST", json: { body, sample } });
}
