import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
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
  Slash,
  Star,
} from "lucide-react";
import { PERMISSION, type Permission } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { useBranding } from "../../hooks/useBranding";
import { useEscapeKey } from "../../hooks/useEscapeKey";

export interface MenuItem {
  to: string;
  label: string;
  icon: typeof MessagesSquare;
  permission: Permission;
}

// What's shown here is governed by Configurações > Permissões, not a fixed
// role list — an ADMIN always sees everything (their permissions are always
// all-true), while AGENT/MANAGER visibility follows whatever's configured.
// Exported so BottomNav can build its own (permission-filtered, same order)
// mobile tab bar from the exact same list instead of duplicating it.
export const MENU_ITEMS: MenuItem[] = [
  { to: "/atendimento", label: "Atendimento", icon: MessagesSquare, permission: PERMISSION.ATENDIMENTO_ACESSAR },
  { to: "/gestao", label: "Gestão", icon: Eye, permission: PERMISSION.GESTAO_ACESSAR },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: PERMISSION.DASHBOARD_ACESSAR },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart, permission: PERMISSION.RELATORIOS_ACESSAR },
  { to: "/usuarios", label: "Usuários", icon: Users, permission: PERMISSION.USUARIOS_GERENCIAR },
  { to: "/respostas-rapidas", label: "Respostas Rápidas", icon: Slash, permission: PERMISSION.RESPOSTAS_RAPIDAS_GERENCIAR },
  { to: "/configuracoes", label: "Configurações", icon: Settings, permission: PERMISSION.CONFIGURACOES_GERENCIAR },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText, permission: PERMISSION.AUDITORIA_ACESSAR },
];

/** Same permission filter Sidebar and BottomNav both need, kept in one place so they can never drift apart. */
export function useVisibleMenuItems(): MenuItem[] {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  return MENU_ITEMS.filter((item) => user && permissions?.[item.permission]);
}

const FAVORITES_KEY = "sidebar-favorites";
// Below this many menu items there's nothing to shortcut — an attendant with only Atendimento sees no stars.
const FAVORITES_MIN_ITEMS = 6;

/** The screens this person starred, remembered per user in this browser. */
function useFavoriteMenuItems(userId: string | undefined) {
  const key = `${FAVORITES_KEY}:${userId ?? "anon"}`;
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setFavorites(raw ? (JSON.parse(raw) as string[]).filter((v) => typeof v === "string") : []);
    } catch {
      setFavorites([]);
    }
  }, [key]);
  function toggle(to: string) {
    setFavorites((current) => {
      const next = current.includes(to) ? current.filter((f) => f !== to) : [...current, to];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage blocked: the star just won't survive a reload
      }
      return next;
    });
  }
  return { favorites, toggle };
}

export function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  useEscapeKey(() => onMobileClose?.(), mobileOpen);
  const [collapsed, setCollapsed] = useState(false);
  const { data: branding } = useBranding();

  const visibleItems = useVisibleMenuItems();
  const userId = useAuthStore((s) => s.user?.id);
  const { favorites, toggle: toggleFavorite } = useFavoriteMenuItems(userId);
  const canFavorite = visibleItems.length >= FAVORITES_MIN_ITEMS;
  const favoriteItems = canFavorite ? favorites.map((to) => visibleItems.find((i) => i.to === to)).filter((i): i is MenuItem => Boolean(i)) : [];
  const sections: { title: string | null; items: MenuItem[] }[] = favoriteItems.length
    ? [
        { title: "Favoritos", items: favoriteItems },
        { title: "Menu", items: visibleItems },
      ]
    : [{ title: null, items: visibleItems }];

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

      <nav className="flex-1 overflow-y-auto p-3" aria-label="Menu principal">
        {sections.map((section, sectionIndex) => (
          <div key={section.title ?? "menu"} role={section.title ? "group" : undefined} aria-label={section.title ?? undefined}>
            {section.title &&
              (collapsed ? (
                sectionIndex > 0 && <div className="mx-auto my-2 h-px w-6 bg-border" aria-hidden />
              ) : (
                <p className={clsx("px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted", sectionIndex === 0 ? "pt-0.5" : "pt-4")}>{section.title}</p>
              ))}
            <div className="space-y-1">
              {section.items.map((item) => {
                const starred = favorites.includes(item.to);
                return (
                  <div key={`${section.title}-${item.to}`} className="group/item relative">
                    <NavLink
                      to={item.to}
                      onClick={onMobileClose}
                      className={({ isActive }) =>
                        clsx(
                          "focus-ring flex items-center gap-3 rounded-card px-3 py-2.5 text-sm font-medium transition-colors",
                          canFavorite && !collapsed && "pr-9",
                          isActive ? "bg-primary text-primary-fg shadow-soft" : "text-muted hover:bg-surface-alt hover:text-[var(--color-text)]"
                        )
                      }
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                    {canFavorite && !collapsed && (
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.to)}
                        aria-pressed={starred}
                        aria-label={starred ? `Tirar ${item.label} dos favoritos` : `Fixar ${item.label} nos favoritos`}
                        title={starred ? "Tirar dos favoritos" : "Fixar nos favoritos"}
                        className="focus-ring absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:text-[var(--color-text)] focus-visible:opacity-100 group-hover/item:opacity-100"
                      >
                        <Star className={clsx("h-3.5 w-3.5", starred && "fill-current text-secondary")} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      </aside>
    </>
  );
}
