/**
 * 人机验证的两个懒加载分块的动态 import(测试用它模拟分块加载失败:vitest 不能让 import() 本身被拒绝)。
 * 外壳与登录页的 lazy 在这里之上加 .catch,失败时显示既有的通用文案与重试按钮。
 */
export const loadCaptchaWidget = () => import("./captcha-widget").then((m) => ({ default: m.CaptchaWidget }));
export const loadCaptchaField = () => import("./captcha-field").then((m) => ({ default: m.CaptchaField }));
