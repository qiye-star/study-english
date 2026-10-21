import { lazy, Suspense, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "~/auth/auth-context";
import { AnnouncementBanner, pickText, refreshAnnouncements, useAnnouncements } from "~/components/announcement-banner";
import { MaintenanceScreen } from "~/components/maintenance-screen";
import { RequireAuth } from "~/auth/require-auth";
import { ChatHubLayout } from "~/pages/chat-hub";
import { ConversationPage, ConversationsPage } from "~/features/chat";
import { AssessmentPage, HistoryPage, PracticeListPage, PracticePage, ShadowPage } from "~/features/practice";
import { ProgressPage } from "~/features/progress";
import { AchievementsPage, MatchPage, RankHomePage } from "~/features/rank";
import { RoomInvitePage, RoomPage, RoomSummaryPage, RoomsEndedPage, RoomsLobbyPage } from "~/features/rooms";
import { VocabularyPage } from "~/features/vocabulary";
import { AgentSettingsPage, MemoryPage } from "~/features/agents";
import {
  WordbookBooksPage, WordbookHomePage, WordbookLearnedPage, WordbookLearnPage, WordbookReviewPage, WordbookSpellPage,
} from "~/features/wordbook";
import { LibraryListPage, LibraryPlayerPage } from "~/features/library";
import { ChangelogPage } from "~/features/changelog";
import { AccountSettingsPage, BindEmailPage, BindingBanner, ForgotPasswordPage, RegisterPage } from "~/features/account";
import { GrammarPromptPage } from "~/features/grammar";
import { AppShell } from "~/layout/app-shell";
import { ColorSchemeSync } from "~/layout/color-scheme-sync";
import { useIsDark } from "~/layout/color-scheme";
import { allRoutes } from "~/lib/extension-points";
import { LinkRoute, Slot } from "~/lib/extension-points-react";
import { InstallPage } from "~/pages/install-page";
import { LoginPage } from "~/pages/login-page";
import { MePage } from "~/pages/me-page";
import { SettingsProvider } from "~/settings/settings-context";
import { TOAST_CLASSNAMES } from "~/components/toast-classes";

/** 外观与主题(计划 2026-10-15-liquid-glass L3):懒加载,不进主包;液态开关关闭时页面自己跳回 /me。 */
const AppearancePage = lazy(() => import("~/pages/appearance/appearance-page").then((m) => ({ default: m.AppearancePage })));
const MeServicesPage = lazy(() => import("~/pages/me-services-page").then((m) => ({ default: m.MeServicesPage })));
/** 我的 → 朗读音色(/me/voice,按场景选音色):懒加载 */
const VoiceSettingsRoute = lazy(() => import("~/pages/voice-settings-route").then((m) => ({ default: m.VoiceSettingsRoute })));

/**
 * 公告横幅放在所有页面的顶部;下方区域把 --app-height 改成 100%,应用壳因此让出横幅的高度。
 * 全站维护(full)时整页显示维护页,不渲染任何路由与导航。
 */
export function AnnouncementFrame() {
  const state = useAnnouncements();
  const { i18n } = useTranslation();
  if (state?.maintenance.mode === "full") {
    const m = state.maintenance;
    // html/body 已固定(index.css),维护页自己提供滚动容器;横屏小屏文字超出时才能滚动
    return (
      <div className="h-[100dvh] overflow-y-auto">
        <MaintenanceScreen message={pickText(i18n.language, m.messageZh, m.messageEn)} onRetry={() => void refreshAnnouncements()} />
      </div>
    );
  }
  return (
    <div className="page-bg flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
      <AnnouncementBanner />
      <BindingBanner />
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
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/install" element={<InstallPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<><Slot point="appEffects" props={{}} /><AppShell /></>}>
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/practice/shadow" element={<ShadowPage />} />
            <Route path="/practice/history" element={<HistoryPage />} />
            <Route path="/practice/list" element={<PracticeListPage />} />
            <Route path="/practice/changelog" element={<ChangelogPage />} />
            <Route path="/practice/assessments/:id" element={<AssessmentPage />} />
            <Route path="/chat" element={<ChatHubLayout section="chat">{(e) => <ConversationsPage embedded={e} />}</ChatHubLayout>} />
            <Route path="/chat/:id" element={<ConversationPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/vocabulary" element={<VocabularyPage />} />
            <Route path="/rank" element={<RankHomePage />} />
            <Route path="/rank/match/:id" element={<MatchPage />} />
            <Route path="/rank/achievements" element={<AchievementsPage />} />
            <Route path="/rooms" element={<ChatHubLayout section="rooms">{(e) => <RoomsLobbyPage embedded={e} />}</ChatHubLayout>} />
            <Route path="/rooms/ended" element={<ChatHubLayout section="rooms-ended">{(e) => <RoomsEndedPage embedded={e} />}</ChatHubLayout>} />
            <Route path="/rooms/r/:roomId" element={<RoomPage />} />
            <Route path="/rooms/r/:roomId/summary" element={<RoomSummaryPage />} />
            <Route path="/rooms/invite/:token" element={<RoomInvitePage />} />
            <Route path="/wordbook" element={<WordbookHomePage />} />
            <Route path="/wordbook/books" element={<WordbookBooksPage />} />
            <Route path="/wordbook/learn" element={<WordbookLearnPage />} />
            <Route path="/wordbook/review" element={<WordbookReviewPage />} />
            <Route path="/wordbook/spell" element={<WordbookSpellPage />} />
            <Route path="/wordbook/learned" element={<WordbookLearnedPage />} />
            <Route path="/library" element={<LibraryListPage />} />
            <Route path="/library/:id" element={<LibraryPlayerPage />} />
            <Route path="/account/email" element={<BindEmailPage />} />
            <Route path="/me" element={<MePage />} />
            <Route path="/me/account" element={<AccountSettingsPage />} />
            <Route path="/me/grammar" element={<GrammarPromptPage />} />
            <Route path="/me/services" element={<Suspense fallback={null}><MeServicesPage /></Suspense>} />
            <Route path="/me/agents" element={<AgentSettingsPage />} />
            <Route path="/me/agents/memory" element={<MemoryPage />} />
            <Route path="/me/appearance" element={<Suspense fallback={null}><AppearancePage /></Suspense>} />
            <Route path="/me/voice" element={<Suspense fallback={null}><VoiceSettingsRoute /></Suspense>} />
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
        classNames: TOAST_CLASSNAMES,
      }} />;
}

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <ColorSchemeSync />
        <AuthProvider>
          <AppRoutes />
          <ThemedToaster />
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
