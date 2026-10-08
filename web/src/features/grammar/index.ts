// grammar 的公共接口:其他目录只能从这里引入 grammar(由 src/architecture.test.ts 约束)。
export type { GrammarCategory, GrammarResult } from "./grammar-types";
export { GRAMMAR_SERVER_ERRORS, MAX_GRAMMAR_TEXT, bumpGrammarRev, cachedGrammar } from "./grammar-api";
export { GrammarPromptEditor } from "./grammar-prompt-editor";
