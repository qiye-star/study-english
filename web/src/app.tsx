import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "~/auth/auth-context";
import { AnnouncementBanner, pickText, refreshAnnouncements, useAnnouncements } from "~/components/announcement-banner";
import { MaintenanceScreen } from "~/components/maintenance-screen";
import { RequireAuth } from "~/auth/require-auth";
import { ConversationPage, ConversationsPage } from "~/features/chat";
import { AssessmentPage, HistoryPage, PracticeListPage, PracticePage } from "~/features/practice";
import { ProgressPage } from "~/features/progress";
import { AchievementsPage, MatchPage, RankHomePage } from "~/features/rank";
import { RoomInvitePage, RoomPage, RoomSummaryPage, RoomsEndedPage, RoomsLobbyPage } from "~/features/rooms";
import { VocabularyPage } from "~/features/vocabulary";
import { AgentSettingsPage, MemoryPage } from "~/features/agents";
import {
  WordbookBooksPage, WordbookHomePage, WordbookLearnedPage, WordbookLearnPage, WordbookReviewPage, WordbookSpellPage,
} from "~/features/wordbook";
import { AppShell } from "~/layout/app-shell";
import { useIsDark } from "~/layout/color-scheme";
import { allRoutes } from "~/lib/extension-points";
import { LinkRoute, Slot } from "~/lib/extension-points-react";
import { InstallPage } from "~/pages/install-page";
import { LoginPage } from "~/pages/login-page";
import { MePage } from "~/pages/me-page";
import { SettingsProvider } from "~/settings/settings-context";

/**
 * 公告横幅放在所有页面的顶部;下方区域把 --app-height 改成 100%,应用壳因此让出横幅的高度。
 * 全站维护(full)时整页显示维护页,不渲染任何路由与导航。
 */
export function AnnouncementFrame() {
  const state = useAnnouncements();
  const { i18n } = useTranslation();
  if (state?.maintenance.mode === "full") {
    const m = state.maintenance;
    return <MaintenanceScreen message={pickText(i18n.language, m.messageZh, m.messageEn)} onRetry={() => void refreshAnnouncements()} />;
  }
  return (
    <div className="flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
      <AnnouncementBanner />
      <div className="relative min-h-0 flex-1 overflow-y-auto" style={{ "--app-height": "100%" } as CSSProperties}>
        <Outlet />
      </div>
    </div>
  );
}

export function AppRoutes() {
  // 联动的路由贡献(plugins/):全部挂上,由 LinkRoute 按旗标渲染 / 等待旗标 / 跳回练习页(spec §8.3)
  const routes = allRoutes().map((r) => <Route key={r.id} path={r.path} element={<LinkRoute route={r} />} />);
  return (
    <Routes>
      <Route element={<AnnouncementFrame />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/install" element={<InstallPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<><Slot point="appEffects" props={{}} /><AppShell /></>}>
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/practice/history" element={<HistoryPage />} />
            <Route path="/practice/list" element={<PracticeListPage />} />
            <Route path="/practice/assessments/:id" element={<AssessmentPage />} />
            <Route path="/chat" element={<ConversationsPage />} />
            <Route path="/chat/:id" element={<ConversationPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/vocabulary" element={<VocabularyPage />} />
            <Route path="/rank" element={<RankHomePage />} />
            <Route path="/rank/match/:id" element={<MatchPage />} />
            <Route path="/rank/achievements" element={<AchievementsPage />} />
            <Route path="/rooms" element={<RoomsLobbyPage />} />
            <Route path="/rooms/ended" element={<RoomsEndedPage />} />
            <Route path="/rooms/r/:roomId" element={<RoomPage />} />
            <Route path="/rooms/r/:roomId/summary" element={<RoomSummaryPage />} />
            <Route path="/rooms/invite/:token" element={<RoomInvitePage />} />
            <Route path="/wordbook" element={<WordbookHomePage />} />
            <Route path="/wordbook/books" element={<WordbookBooksPage />} />
            <Route path="/wordbook/learn" element={<WordbookLearnPage />} />
            <Route path="/wordbook/review" element={<WordbookReviewPage />} />
            <Route path="/wordbook/spell" element={<WordbookSpellPage />} />
            <Route path="/wordbook/learned" element={<WordbookLearnedPage />} />
            <Route path="/me" element={<MePage />} />
            <Route path="/me/agents" element={<AgentSettingsPage />} />
            <Route path="/me/agents/memory" element={<MemoryPage />} />
            {routes}
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/practice" replace />} />
      </Route>
    </Routes>
  );
}

export function ThemedToaster() {
  return <Toaster position="top-center" closeButton theme={useIsDark() ? "dark" : "light"}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: "!rounded-card !border-0 !bg-surface/90 !text-ink !shadow-hair backdrop-blur-xl backdrop-saturate-150",
          description: "!text-ink-2",
          closeButton: "!border-0 !bg-surface-2 !text-ink-2 !shadow-hair",
          success: "[&_[data-icon]]:!text-green",
          error: "[&_[data-icon]]:!text-red",
          warning: "[&_[data-icon]]:!text-amber",
          info: "[&_[data-icon]]:!text-blue",
        },
      }} />;
}

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <AppRoutes />
          <ThemedToaster />
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
