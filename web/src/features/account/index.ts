// account 的公共接口:其他目录只能从这里引入 account(由 src/architecture.test.ts 约束)。
// 只导出懒加载入口;账号区的 API 函数不对外开放(X35)。
export { AccountSection, ForgotPasswordPage, RegisterPage } from "./lazy";
