/**
 * 人机验证组件分块的唯一动态 import(测试用它模拟分块加载失败:vitest 不能让 import() 本身被拒绝)。
 * 外壳的 lazy 在这里之上加 .catch,失败时显示提示与重新加载(见 load-failed.tsx)。
 */
export const loadCaptchaWidget = () => import("./captcha-widget").then((m) => ({ default: m.CaptchaWidget }));
