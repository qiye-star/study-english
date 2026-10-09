// enjoy/src 中被 web 复用的非组件资源:语言表、桌面端文案、提示词源码文本。
// web 只经由 src/shims 读取 enjoy(`@/…`);此处只做转出,不改内容。
export { LANGUAGES } from "@/shared/constants";
export { default as enjoyEn } from "@/shared/i18n/en.json";
export { default as enjoyEs } from "@/shared/i18n/es.json";
export { default as enjoyZh } from "@/shared/i18n/zh-CN.json";
// 依赖 @langchain 且常量未导出:只以 ?raw 读入源码文本,由 features/lookup/prompts.ts 提取。
export { default as lookupCommandSource } from "@/shared/commands/lookup.command.ts?raw";
export { default as translateCommandSource } from "@/shared/commands/translate.command.ts?raw";
