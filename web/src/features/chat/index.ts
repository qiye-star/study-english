// chat 的公共接口:其他目录只能从这里引入 chat(由 src/architecture.test.ts 约束)。
export { ConversationPage } from "./lazy-pages"; // 路由懒加载(R-W2);不要在这里静态导出页面模块
export { ConversationsPage } from "./conversations-page";
export { primeAudioElement, sharedAutoplayAudio, ttsErrorMessage, useTtsPlayer, type TtsState } from "./use-tts-player";
export { useMessageTranslations, type TranslationState } from "./use-message-translations";
// 登出清理(auth/device-data)
export { sharedTtsCache } from "./tts";
export { clearHintsMemory } from "./hints";
export { clearComposerMode } from "./composer-mode";
export { clearChatHomeCache } from "./home/chat-home-cache";
