import { Navigate, Route, Routes } from "react-router-dom";
import { useBootstrapSession } from "./hooks/useBootstrapSession";
import { useAuthStore } from "./store/auth-store";
import { ProtectedRoute, RoleRoute } from "./components/layout/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import LoginPage from "./pages/login/LoginPage";
import ResetPasswordPage from "./pages/login/ResetPasswordPage";
import AtendimentoPage from "./pages/atendimento/AtendimentoPage";
import GestaoPage from "./pages/gestao/GestaoPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import RelatoriosPage from "./pages/relatorios/RelatoriosPage";
import UsuariosPage from "./pages/usuarios/UsuariosPage";
import ConfiguracoesPage from "./pages/configuracoes/ConfiguracoesPage";

function RoleHome() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  if (user.role === "AGENT") return <Navigate to="/atendimento" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  useBootstrapSession();
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) {
    return <div className="flex h-screen items-center justify-center text-muted">Carregando...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<RoleHome />} />

          <Route element={<RoleRoute roles={["AGENT"]} />}>
            <Route path="/atendimento" element={<AtendimentoPage />} />
          </Route>

          <Route element={<RoleRoute roles={["MANAGER", "ADMIN"]} />}>
            <Route path="/gestao" element={<GestaoPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/relatorios" element={<RelatoriosPage />} />
          </Route>

          <Route element={<RoleRoute roles={["ADMIN"]} />}>
            <Route path="/usuarios" element={<UsuariosPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
