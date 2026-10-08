import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useToken } from "./api/session";
import { AppShell } from "./components/layout";
import { AssessmentDetailPage } from "./pages/assessment-detail-page";
import { AssessmentsPage } from "./pages/assessments-page";
import { ConversationPage } from "./pages/conversation-page";
import { LoginPage } from "./pages/login-page";
import { OverviewPage } from "./pages/overview-page";
import { UserDetailPage } from "./pages/user-detail-page";
import { UsersPage } from "./pages/users-page";

/** 未登录(或 token 被 401 清掉)一律跳 /login,并记住来源页。 */
export function RequireAuth() {
  const token = useToken();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="conversations/:id" element={<ConversationPage />} />
          <Route path="assessments" element={<AssessmentsPage />} />
          <Route path="assessments/:id" element={<AssessmentDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
