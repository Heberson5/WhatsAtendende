import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAuthStore } from "../../store/auth-store";
import { connectSocket, disconnectSocket, getSocket } from "../../lib/socket";
import { useDesktopNotificationPermission } from "../../hooks/useDesktopNotifications";
import { useIdleLogout } from "../../hooks/useIdleLogout";

const TITLES: Record<string, string> = {
  "/atendimento": "Atendimento",
  "/gestao": "Gestão",
  "/dashboard": "Dashboard",
  "/relatorios": "Relatórios",
  "/usuarios": "Usuários",
  "/configuracoes": "Configurações",
  "/perfil": "Meu Perfil",
};

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useDesktopNotificationPermission();
  useIdleLogout();

  useEffect(() => {
    if (accessToken) connectSocket(accessToken);
    return () => disconnectSocket();
  }, [accessToken]);

  // Either an admin disconnected this account from Usuários, or this same
  // account just logged in somewhere else (only one active session is
  // allowed — see auth.service.ts's login) — the server already killed the
  // live socket in both cases; this just gets the UI itself out of the
  // now-dead session before the still-valid-for-a-few-more-minutes access
  // token lets any stale screen keep looking usable.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (payload?: { reason?: "ADMIN" | "NEW_LOGIN" }) => {
      toast.error(
        payload?.reason === "NEW_LOGIN"
          ? "Sua conta foi acessada em outro local. Esta sessão foi encerrada."
          : "Sua sessão foi encerrada por um administrador."
      );
      clearSession();
      navigate("/login");
    };
    socket.on("user:force-logout", handler);
    return () => {
      socket.off("user:force-logout", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // A route change from tapping a NavLink already closes the drawer (see
  // Sidebar's onClick), but this also covers programmatic navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const title = TITLES[location.pathname] ?? "WhatsAtendende";

  return (
    <div className="flex h-screen gap-2 overflow-hidden bg-[var(--color-bg)] p-2 sm:gap-3 sm:p-3">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-soft">
        <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
