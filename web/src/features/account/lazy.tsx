import { lazy, Suspense } from "react";
import { useAuth } from "~/auth/auth-context";

/** 账号区按需加载(X23):「我的」页只留一个占位,账号区本身是单独的块。 */
const AccountSectionBody = lazy(() => import("./account-section").then((m) => ({ default: m.AccountSection })));
const RegisterPageBody = lazy(() => import("./signup-page").then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPageBody = lazy(() => import("./forgot-password-page").then((m) => ({ default: m.ForgotPasswordPage })));
const BindEmailPageBody = lazy(() => import("./bind-email-page").then((m) => ({ default: m.BindEmailPage })));
const PendingBindingBannerBody = lazy(() => import("./binding-banner").then((m) => ({ default: m.PendingBindingBanner })));
const MyInvitePanelBody = lazy(() => import("./invites/my-invite-panel").then((m) => ({ default: m.MyInvitePanel })));
const AccountSettingsPageBody = lazy(() => import("./account-settings-page").then((m) => ({ default: m.AccountSettingsPage })));

/** 账号设置页(/me/account)按路由懒加载;页面本身只组合 AccountSection / MyInviteSection。 */
export function AccountSettingsPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh]" />}>
      <AccountSettingsPageBody />
    </Suspense>
  );
}

/** 「我的邀请码」按需加载(W2);挂在「我的」页的账号区之后。 */
export function MyInviteSection() {
  return (
    <Suspense fallback={<div aria-busy="true" className="mt-4 min-h-[120px]" />}>
      <MyInvitePanelBody />
    </Suspense>
  );
}

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

/** 绑定邮箱页按路由懒加载(X26);挂在 RequireAuth 之下。 */
export function BindEmailPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[120px]" />}>
      <BindEmailPageBody />
    </Suspense>
  );
}

/** 截止前横幅:只有待绑定时才加载横幅的代码块。 */
export function BindingBanner() {
  const { emailStatus } = useAuth();
  if (emailStatus?.binding.state !== "pending") return null;
  return (
    <Suspense fallback={null}>
      <PendingBindingBannerBody />
    </Suspense>
  );
}
