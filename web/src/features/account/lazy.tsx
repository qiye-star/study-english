import { lazy, Suspense } from "react";

/** 账号区按需加载(X23):「我的」页只留一个占位,账号区本身是单独的块。 */
const AccountSectionBody = lazy(() => import("./account-section").then((m) => ({ default: m.AccountSection })));
const RegisterPageBody = lazy(() => import("./signup-page").then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPageBody = lazy(() => import("./forgot-password-page").then((m) => ({ default: m.ForgotPasswordPage })));

export function AccountSection() {
  return (
    <Suspense fallback={<div aria-busy="true" className="mt-4 min-h-[120px]" />}>
      <AccountSectionBody />
    </Suspense>
  );
}

/** 注册页按路由懒加载,不进主包。 */
export function RegisterPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh]" />}>
      <RegisterPageBody />
    </Suspense>
  );
}

/** 找回密码页按路由懒加载,不进主包。 */
export function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh]" />}>
      <ForgotPasswordPageBody />
    </Suspense>
  );
}
