/**
 * 提示词校验的前端镜像:与服务端 `app/services/prompts.py::validate_prompt` 同一规则,
 * 只用于实时提示;服务端在发布时再校验一次(以服务端为准)。
 *
 * 占位符写法同 Python `str.format`:`{name}`;`{{` / `}}` 是字面量花括号。
 */

export interface PromptRules {
  kind: "text" | "json";
  required: string[];
  boundaries: string[];
  maxChars: number;
  /** false = 正文原样使用(不做 format),花括号不检查(语法规则) */
  formatted?: boolean;
}

export interface PromptCheck {
  /** 服务端同名错误码:empty、too_long、invalid_braces、missing_fields:a,b、unknown_fields:x、missing_boundary:<tag>、invalid_json、invalid_templates */
  errors: string[];
  missing: string[];
  unknown: string[];
  missingBoundaries: string[];
  invalidBraces: boolean;
  /** 清洗后的字符数(按 Unicode 码点,与服务端 len() 一致) */
  length: number;
}

// C0/C1 controls except \t \n, plus U+2028 / U+2029 (line / paragraph separators), as on the server
const SEPARATORS = String.fromCharCode(0x2028, 0x2029);
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp(`[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f${SEPARATORS}]`, "g");
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPLATE_KEY = /^[a-z0-9-]{1,48}$/;
export const TEMPLATE_LIMITS = { key: 48, name: 60, description: 200, prompt: 4000 } as const;
export const MAX_TEMPLATES = 50;

/** 同服务端 `clean_prompt`:统一换行、去掉 \n \t 以外的控制字符、去首尾空白。 */
export function cleanPrompt(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
}

export function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * 解析占位符,返回每个字段的原文(`{a}` → "a"、`{a.b}` → "a.b"、`{a:x}` → "a:x"、`{}` → "{}");
 * 花括号不配对返回 null(同 Python 的 ValueError)。
 */
export function parsePlaceholders(body: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "{") {
      if (body[i + 1] === "{") {
        i += 2;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === "{") depth += 1;
        else if (body[j] === "}") depth -= 1;
        if (depth > 0) j += 1;
      }
      if (depth !== 0) return null;
      const inner = body.slice(i + 1, j);
      out.push(inner === "" ? "{}" : inner);
      i = j + 1;
      continue;
    }
    if (ch === "}") {
      if (body[i + 1] !== "}") return null;
      i += 2;
      continue;
    }
    i += 1;
  }
  return out;
}

export interface ChatTemplate {
  key: string;
  name: string;
  description: string;
  prompt: string;
}

/** 情景模板逐行问题(下标 → 文案键);空对象 = 全部有效。 */
export function templateRowProblems(rows: ChatTemplate[]): Record<number, ("key" | "duplicate" | "name" | "description" | "prompt")[]> {
  const problems: Record<number, ("key" | "duplicate" | "name" | "description" | "prompt")[]> = {};
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const list: ("key" | "duplicate" | "name" | "description" | "prompt")[] = [];
    if (!TEMPLATE_KEY.test(row.key)) list.push("key");
    else if (seen.has(row.key)) list.push("duplicate");
    else seen.set(row.key, index);
    if (!row.name.trim() || charCount(row.name) > TEMPLATE_LIMITS.name) list.push("name");
    if (charCount(row.description) > TEMPLATE_LIMITS.description) list.push("description");
    if (!row.prompt.trim() || charCount(row.prompt) > TEMPLATE_LIMITS.prompt) list.push("prompt");
    if (list.length) problems[index] = list;
  });
  return problems;
}

function templatesValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TEMPLATES) return false;
  const fields = Object.keys(TEMPLATE_LIMITS);
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const keys = Object.keys(item);
    if (keys.length !== fields.length || !fields.every((f) => keys.includes(f))) return false;
    if (!fields.every((f) => typeof (item as Record<string, unknown>)[f] === "string")) return false;
  }
  return Object.keys(templateRowProblems(value as ChatTemplate[])).length === 0;
}

export function checkPrompt(rules: PromptRules, raw: string): PromptCheck {
  const body = cleanPrompt(raw);
  const length = charCount(body);
  const result: PromptCheck = { errors: [], missing: [], unknown: [], missingBoundaries: [], invalidBraces: false, length };
  if (!body) return { ...result, errors: ["empty"] };
  if (length > rules.maxChars) return { ...result, errors: ["too_long"] };
  if (rules.kind === "json") {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return { ...result, errors: ["invalid_json"] };
    }
    return templatesValid(value) ? result : { ...result, errors: ["invalid_templates"] };
  }
  if (rules.formatted !== false) {
    const fields = parsePlaceholders(body);
    if (fields === null) {
      result.invalidBraces = true;
      result.errors.push("invalid_braces");
    } else {
      const seen = new Set(fields);
      result.missing = rules.required.filter((f) => !seen.has(f));
      result.unknown = [...seen].filter((f) => !rules.required.includes(f) || !IDENT.test(f)).sort();
      if (result.missing.length) result.errors.push(`missing_fields:${[...result.missing].sort().join(",")}`);
      if (result.unknown.length) result.errors.push(`unknown_fields:${result.unknown.join(",")}`);
    }
  }
  result.missingBoundaries = rules.boundaries.filter((tag) => !body.includes(tag));
  result.errors.push(...result.missingBoundaries.map((tag) => `missing_boundary:${tag}`));
  return result;
}
