/**
 * 查词与翻译提示词复用桌面端原文:enjoy/src/commands/lookup.command.ts(DICITIONARY_PROMPT)
 * 与 enjoy/src/commands/translate.command.ts(SYSTEM_PROMPT、TRANSLATION_PROMPT)。
 * 这两个文件依赖 @langchain 且常量未导出,因此只以 ?raw 读入源码文本并提取(不执行、不复制)。
 */
import lookupSource from "@/commands/lookup.command.ts?raw";
import translateSource from "@/commands/translate.command.ts?raw";

export function extractPrompt(source: string, pattern: RegExp, name: string): string {
  // Windows checkouts may use CRLF; normalise so prompts are identical everywhere.
  const match = source.replace(/\r\n?/g, "\n").match(pattern);
  if (!match) throw new Error(`Prompt ${name} not found in enjoy source`);
  return match[1];
}

export const DICTIONARY_PROMPT = extractPrompt(lookupSource, /const DICITIONARY_PROMPT = `([\s\S]*?)`;/, "DICITIONARY_PROMPT");
export const TRANSLATION_SYSTEM_PROMPT = extractPrompt(translateSource, /const SYSTEM_PROMPT =\s*"([^"]*)";/, "SYSTEM_PROMPT");
export const TRANSLATION_PROMPT = extractPrompt(translateSource, /const TRANSLATION_PROMPT = `([\s\S]*?)`;/, "TRANSLATION_PROMPT");

/** LangChain 模板语法:{name} 为变量,{{ 与 }} 为字面花括号;未知变量原样保留。 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (token, name?: string) => {
    if (token === "{{") return "{";
    if (token === "}}") return "}";
    return name && Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : token;
  });
}
