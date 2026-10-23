// chat 的公共接口:其他目录只能从这里引入 chat(由 src/architecture.test.ts 约束)。
export { ConversationPage, ConversationsPage } from "./lazy-pages"; // 路由懒加载(R-W2);不要在这里静态导出页面模块
// 路由分发:按 CHAT_HOME_ENABLED 选新对话主页或旧页面(app.tsx 的三条 /chat 路由)
export { ChatConversationRoute, ChatIndexRoute, ChatNewRoute } from "./home/routes";
export { primeAudioElement, sharedAutoplayAudio, ttsErrorMessage, useTtsPlayer, type TtsState } from "./use-tts-player";
export { PREVIEW_SENTENCE } from "./voice-picker"; // 朗读音色页的试听句
export { useMessageTranslations, type TranslationState } from "./use-message-translations";
// 登出清理(auth/device-data)
export { sharedTtsCache } from "./tts";
export { clearHintsMemory } from "./hints";
export { clearComposerMode } from "./composer-mode";
export { clearChatHomeCache } from "./home/chat-home-cache";
