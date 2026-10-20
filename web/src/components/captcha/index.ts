// 人机验证的公共接口(共享层):只导出外壳与句柄类型;组件分块不对外暴露。
export { CaptchaField, type CaptchaFieldProps } from "./captcha-field";
export type { CaptchaHandle } from "./captcha-widget";
