import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
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
};

export function AppLayout() {
  const location = useLocation();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken) connectSocket(accessToken);
    return () => disconnectSocket();
  }, [accessToken]);

  const title = TITLES[location.pathname] ?? "WhatsAtendende";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title={title} />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
