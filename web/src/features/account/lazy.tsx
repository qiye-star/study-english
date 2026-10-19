import { lazy, Suspense } from "react";

/** 账号区按需加载(X23):「我的」页只留一个占位,账号区本身是单独的块。 */
const AccountSectionBody = lazy(() => import("./account-section").then((m) => ({ default: m.AccountSection })));

export function AccountSection() {
  return (
    <Suspense fallback={<div aria-busy="true" className="mt-4 min-h-[120px]" />}>
      <AccountSectionBody />
    </Suspense>
  );
}
