function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a model's JSON object defensively: code fences and surrounding prose are tolerated. */
export function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const cleaned = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data = parseObject(cleaned);
  if (!data) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) data = parseObject(cleaned.slice(start, end + 1));
  }
  return data;
}
