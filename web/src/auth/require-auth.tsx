import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { EMAIL_BINDING_PATH } from "./email-binding";

export function RequireAuth() {
  const { user, signedOutByUser, bindingRequired } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={signedOutByUser ? undefined : { from: location.pathname }} />;
  // X26:强制绑定期间除绑定页外都挡到绑定页;绑定页本身不再重定向,所以不会循环。
  if (bindingRequired && location.pathname !== EMAIL_BINDING_PATH) {
    return <Navigate to={`${EMAIL_BINDING_PATH}?required=1`} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
