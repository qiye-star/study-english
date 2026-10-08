// lookup 的公共接口:其他目录只能从这里引入 lookup(由 src/architecture.test.ts 约束)。
export { LOOKUP_SERVER_ERRORS, cachedTranslate, normalizeSelection, type LookupResult } from "./lookup";
export type { TextSelectionInfo } from "./use-text-selection";
export { LookupLayer } from "./lookup-layer";
