import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "~/auth/auth-context";
import { RequireAuth } from "~/auth/require-auth";
import { ConversationPage } from "~/features/chat/conversation-page";
import { ConversationsPage } from "~/features/chat/conversations-page";
import { AssessmentPage } from "~/features/practice/assessment-page";
import { HistoryPage } from "~/features/practice/history-page";
import { PracticeListPage } from "~/features/practice/practice-list-page";
import { PracticePage } from "~/features/practice/practice-page";
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
          <Route path="/me" element={<MePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/practice" replace />} />
    </Routes>
  );
}

export function ThemedToaster() {
  return <Toaster position="top-center" richColors closeButton theme={useIsDark() ? "dark" : "light"} />;
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
