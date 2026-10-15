import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** web/src */
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Source text of a file under web/src (posix path relative to src, e.g. "features/chat/recap-sheet.tsx"). */
export const srcOf = (rel: string): string => readFileSync(path.join(srcRoot, ...rel.split("/")), "utf8");

/** Marked elements in a source: `{...lookupContext}`, `lookupContextIf(` calls and raw `data-lookup-context` attributes. */
export const lookupMarks = (source: string): number =>
  (source.match(/\{\.\.\.lookupContext\}|lookupContextIf\(|data-lookup-context/g) ?? []).length;
