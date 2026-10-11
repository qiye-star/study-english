import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { loadSession, useAdminSession, useSessionStatus } from "./api/session";
import { AppShell } from "./components/layout";
import { Skeleton } from "./components/states";
import { AuditPage } from "./features/audit";
import { LinksPage } from "./features/links";
import { AnnouncementsPage, DataPage, LogsPage, SystemPage } from "./features/ops";
import { PromptDetailPage, PromptsPage } from "./features/prompts";
import { MatchPage, RankPage, RankRulesPage } from "./features/rank";
import { ReportsPage, RoomDetailPage, RoomsPage } from "./features/rooms";
import { SecurityPage } from "./features/security";
import { SettingsPage } from "./features/settings";
import { UsagePage } from "./features/usage";
import { InvitesPage } from "./features/users";
import { WordbookPage } from "./features/wordbook";
import { AssessmentDetailPage } from "./pages/assessment-detail-page";
import { AssessmentsPage } from "./pages/assessments-page";
import { ConversationPage } from "./pages/conversation-page";
import { LoginPage } from "./pages/login-page";
import { OverviewPage } from "./pages/overview-page";
import { UserDetailPage } from "./pages/user-detail-page";
import { UsersPage } from "./pages/users-page";

/**
 * 会话在 HttpOnly Cookie 里:首次挂载向服务端确认(`GET /api/admin/session`),确认前显示骨架;
 * 没有会话(或被 401 清掉)一律跳 /login,并记住来源页。
 */
export function RequireAuth() {
  const session = useAdminSession();
  const status = useSessionStatus();
  const location = useLocation();

  useEffect(() => {
    if (status === "unknown") void loadSession();
  }, [status]);

  if (status !== "known") {
    return (
      <div className="mx-auto max-w-[600px] p-6">
        <Skeleton rows={4} />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {/* v1 只读页面 */}
          <Route index element={<OverviewPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="conversations/:id" element={<ConversationPage />} />
          <Route path="assessments" element={<AssessmentsPage />} />
          <Route path="assessments/:id" element={<AssessmentDetailPage />} />
          {/* v2:各功能车道在 features/<area>/ 内实现,出口名保持不变 */}
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:group" element={<SettingsPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="rank" element={<RankPage />} />
          <Route path="rank/rules" element={<RankRulesPage />} />
          <Route path="rank/matches/:id" element={<MatchPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="rooms/:id" element={<RoomDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="invites" element={<InvitesPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="wordbook" element={<WordbookPage />} />
          <Route path="links" element={<LinksPage />} />
          <Route path="prompts/:key" element={<PromptDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
