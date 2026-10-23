// 词汇激活的公共接口(计划 L4 Task 15):其他目录只能从这里引入(src/architecture.test.ts 约束)。
// 当前没有别的目录需要引入它:页面与「我的」一行经扩展点登记(register.ts,只被 plugins/ 导入);
// 对话提示词的沉睡词补充(Task 16)同样经 register.ts 登记。需要导出时再加,不要在这里放页面、api 或文案。
export {};
