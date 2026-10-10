// wordbook 的公共接口:其他目录只能从这里引入 wordbook(由 src/architecture.test.ts 约束)。
export { useWordbookConfig, useWordbookEnabled } from "./use-wordbook-config";
export { WordbookSpellPage } from "./spell/spell-page";
