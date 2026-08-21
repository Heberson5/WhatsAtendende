import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAuthStore } from "../../store/auth-store";
import { connectSocket, disconnectSocket } from "../../lib/socket";

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
  const accessToken = useAuthStore((s) => s.accessToken);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (accessToken) connectSocket(accessToken);
    return () => disconnectSocket();
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
