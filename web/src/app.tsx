import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "~/auth/auth-context";
import { RequireAuth } from "~/auth/require-auth";
import { ConversationPage, ConversationsPage } from "~/features/chat";
import { AssessmentPage, HistoryPage, PracticeListPage, PracticePage } from "~/features/practice";
import { ProgressPage } from "~/features/progress";
import { AchievementsPage, MatchPage, RankHomePage } from "~/features/rank";
import { RoomPage, RoomsLobbyPage } from "~/features/rooms";
import { VocabularyPage } from "~/features/vocabulary";
import { AppShell } from "~/layout/app-shell";
import { useIsDark } from "~/layout/color-scheme";
import { InstallPage } from "~/pages/install-page";
import { LoginPage } from "~/pages/login-page";
import { MePage } from "~/pages/me-page";
import { SettingsProvider } from "~/settings/settings-context";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/install" element={<InstallPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
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
          <Route path="/rooms/r/:roomId" element={<RoomPage />} />
          <Route path="/me" element={<MePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/practice" replace />} />
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
