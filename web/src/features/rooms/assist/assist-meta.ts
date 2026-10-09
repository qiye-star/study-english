import type { AssistMeta } from "../protocol";

export interface ParsedAssistMeta extends AssistMeta {
  /** 服务端在这条回复的建议被发到群里后写 meta.used(一个 assist_id 只能用一次) */
  used: boolean;
}

/** 助手回复的 meta 来自服务端 JSON:只取形状对的部分。 */
export function assistMeta(meta: Record<string, unknown> | null | undefined): ParsedAssistMeta | null {
  if (!meta) return null;
  const list = <T,>(v: unknown, ok: (x: Record<string, unknown>) => boolean) =>
    (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && ok(x as Record<string, unknown>)) : []) as T[];
  return {
    replyZh: typeof meta.replyZh === "string" ? meta.replyZh : "",
    suggestions: list<AssistMeta["suggestions"][number]>(meta.suggestions, (x) => typeof x.en === "string" && x.en.trim() !== "")
      .map((s) => ({ en: s.en, noteZh: typeof s.noteZh === "string" ? s.noteZh : "" })),
    glossary: list<AssistMeta["glossary"][number]>(meta.glossary, (x) => typeof x.src === "string" && typeof x.en === "string"),
    used: meta.used === true,
  };
}
