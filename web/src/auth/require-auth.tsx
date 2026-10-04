import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";

export function RequireAuth() {
  const { user, signedOutByUser } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={signedOutByUser ? undefined : { from: location.pathname }} />;
  return <Outlet />;
}
