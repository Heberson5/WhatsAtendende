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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Role } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { useBranding } from "../../hooks/useBranding";

interface MenuItem {
  to: string;
  label: string;
  icon: typeof MessagesSquare;
  roles: Role[];
}

const MENU_ITEMS: MenuItem[] = [
  { to: "/atendimento", label: "Atendimento", icon: MessagesSquare, roles: ["AGENT"] },
  { to: "/gestao", label: "Gestão", icon: Eye, roles: ["MANAGER", "ADMIN"] },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["MANAGER", "ADMIN"] },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart, roles: ["MANAGER", "ADMIN"] },
  { to: "/usuarios", label: "Usuários", icon: Users, roles: ["ADMIN"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, roles: ["ADMIN"] },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const user = useAuthStore((s) => s.user);
  const { data: branding } = useBranding();

  const visibleItems = MENU_ITEMS.filter((item) => user && item.roles.includes(user.role));

  return (
    <aside
      className={clsx(
        "flex h-screen flex-col border-r border-border bg-surface transition-all duration-200",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        {branding?.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.companyName} className="h-8 w-8 rounded object-contain" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-fg">
            {(branding?.companyName ?? "WA").slice(0, 2).toUpperCase()}
          </div>
        )}
        {!collapsed && <span className="truncate font-semibold">{branding?.companyName ?? "WhatsAtendende"}</span>}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Menu principal">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                "focus-ring flex items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt hover:text-[var(--color-text)]"
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="focus-ring flex items-center justify-center gap-2 border-t border-border py-3 text-muted hover:text-[var(--color-text)]"
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
