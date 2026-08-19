import { Navigate, Outlet } from "react-router-dom";
import type { Role } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";

export function ProtectedRoute() {
  const { user, hydrated } = useAuthStore();
  if (!hydrated) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RoleRoute({ roles }: { roles: Role[] }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
