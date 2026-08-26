import { NavLink } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";
import {
  MessagesSquare,
  Eye,
  LayoutDashboard,
  FileBarChart,
  Users,
  Settings,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { PERMISSION, type Permission } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { useBranding } from "../../hooks/useBranding";

interface MenuItem {
  to: string;
  label: string;
  icon: typeof MessagesSquare;
  permission: Permission;
}

// What's shown here is governed by Configurações > Permissões, not a fixed
// role list — an ADMIN always sees everything (their permissions are always
// all-true), while AGENT/MANAGER visibility follows whatever's configured.
const MENU_ITEMS: MenuItem[] = [
  { to: "/atendimento", label: "Atendimento", icon: MessagesSquare, permission: PERMISSION.ATENDIMENTO_ACESSAR },
  { to: "/gestao", label: "Gestão", icon: Eye, permission: PERMISSION.GESTAO_ACESSAR },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSION.DASHBOARD_ACESSAR },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart, permission: PERMISSION.RELATORIOS_ACESSAR },
  { to: "/usuarios", label: "Usuários", icon: Users, permission: PERMISSION.USUARIOS_GERENCIAR },
  { to: "/configuracoes", label: "Configurações", icon: Settings, permission: PERMISSION.CONFIGURACOES_GERENCIAR },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText, permission: PERMISSION.AUDITORIA_ACESSAR },
];

export function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const { data: branding } = useBranding();

  const visibleItems = MENU_ITEMS.filter((item) => user && permissions?.[item.permission]);

  return (
    <>
      {/* Backdrop: only ever rendered (and interactive) on mobile, where the
          sidebar becomes an off-canvas overlay instead of sitting in flow. */}
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onMobileClose} aria-hidden />}
      <aside
        className={clsx(
          "shadow-soft fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-hidden rounded-r-card border border-border bg-surface transition-transform duration-200 md:relative md:inset-auto md:z-10 md:h-full md:translate-x-0 md:rounded-card md:transition-all",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-[72px]" : "md:w-64"
        )}
      >
      <div className={clsx("flex h-16 shrink-0 items-center border-b border-border px-4", collapsed ? "justify-center" : "gap-3")}>
        {!collapsed && (
          <>
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.companyName} className="h-8 w-8 shrink-0 rounded object-contain" />
            ) : (
              <div
                className="shadow-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-fg"
                style={{ backgroundImage: "linear-gradient(145deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 60%)" }}
              >
                {(branding?.companyName ?? "WA").slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="flex-1 truncate font-semibold">{branding?.companyName ?? "WhatsAtendende"}</span>
          </>
        )}
        <button
          type="button"
          onClick={onMobileClose}
          className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted shadow-soft hover:text-[var(--color-text)] md:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="focus-ring hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted shadow-soft hover:text-[var(--color-text)] md:flex"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Menu principal">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onMobileClose}
            className={({ isActive }) =>
              clsx(
                "focus-ring flex items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-primary text-primary-fg shadow-soft" : "text-muted hover:bg-surface-alt hover:text-[var(--color-text)]"
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      </aside>
    </>
  );
}
