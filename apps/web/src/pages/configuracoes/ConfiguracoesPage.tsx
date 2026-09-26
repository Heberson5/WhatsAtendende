import { useState } from "react";
import { PERMISSION, type Permission } from "@whatsatendende/types";
import { WhatsAppConnectionPanel } from "./WhatsAppConnectionPanel";
import { BrandingPanel } from "./BrandingPanel";
import { AppInstallPanel } from "./AppInstallPanel";
import { ExportacoesPanel } from "./ExportacoesPanel";
import { FeriadosPanel } from "./FeriadosPanel";
import { EmailSettingsPanel } from "./EmailSettingsPanel";
import { EmailTemplatesPanel } from "./EmailTemplatesPanel";
import { PermissionsPanel } from "./PermissionsPanel";
import { SecuritySettingsPanel } from "./SecuritySettingsPanel";
import { useAuthStore } from "../../store/auth-store";

type Tab = "whatsapp" | "branding" | "exportacoes" | "email" | "email-templates" | "feriados" | "seguranca" | "permissoes";

const TABS: { key: Tab; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "branding", label: "Identidade visual" },
  { key: "exportacoes", label: "Exportações" },
  { key: "email", label: "E-mail" },
  { key: "email-templates", label: "Modelos de e-mail" },
  { key: "feriados", label: "Feriados" },
  { key: "seguranca", label: "Segurança" },
  { key: "permissoes", label: "Permissões" },
];

// Each sits behind its own finer permission on top of the CONFIGURACOES_GERENCIAR
// umbrella already required to reach /configuracoes at all (see Sidebar's
// MENU_ITEMS) — see PROMPT: "Mapeie todos os menus e o que tem dentro dos
// menus e inclua nas permissões". seguranca/permissoes have no entry — they
// stay ADMIN-only, checked separately below, same as before this feature.
const TAB_PERMISSION: Partial<Record<Tab, Permission>> = {
  whatsapp: PERMISSION.CONFIGURACOES_WHATSAPP_GERENCIAR,
  branding: PERMISSION.CONFIGURACOES_IDENTIDADE_GERENCIAR,
  // Exportações only previews/links to Identidade visual's own controls
  // (logo/cor/nome) — no separate settings of its own — so it sits behind
  // the same permission rather than introducing a new one.
  exportacoes: PERMISSION.CONFIGURACOES_IDENTIDADE_GERENCIAR,
  email: PERMISSION.CONFIGURACOES_EMAIL_GERENCIAR,
  "email-templates": PERMISSION.CONFIGURACOES_EMAIL_MODELOS_GERENCIAR,
  feriados: PERMISSION.CONFIGURACOES_FERIADOS_GERENCIAR,
};

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("whatsapp");
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.permissions);
  // Configurações itself can be reached by a MANAGER granted the
  // "configuracoes.gerenciar" permission, but the permissions matrix and
  // session/security settings are always ADMIN-only — hiding these tabs for
  // anyone else keeps the UI honest about what they can do. (The permissions
  // matrix is enforced ADMIN-only on the backend too, see
  // permissions.routes.ts; PATCH /settings/business is enforced only by the
  // configuracoes.gerenciar permission, same as the other Configurações
  // tabs — this is a UI-only restriction, not a backend one.)
  const visibleTabs = TABS.filter((t) => {
    if (t.key === "permissoes" || t.key === "seguranca") return role === "ADMIN";
    const permission = TAB_PERMISSION[t.key];
    return !permission || permissions?.[permission];
  });
  // The default/last-selected tab can be one a role no longer sees (e.g. an
  // admin restricted "whatsapp" for this manager specifically) — fall back
  // to the first tab that's actually visible instead of rendering nothing.
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : visibleTabs[0]?.key;

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="shadow-soft mb-6 flex flex-wrap gap-1 rounded-card border border-border bg-surface p-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-card px-4 py-2 text-sm font-medium ${activeTab === t.key ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "whatsapp" && <WhatsAppConnectionPanel />}
      {activeTab === "branding" && (
        <div className="space-y-6">
          <BrandingPanel />
          <AppInstallPanel />
        </div>
      )}
      {activeTab === "exportacoes" && <ExportacoesPanel onEditIdentity={() => setTab("branding")} />}
      {activeTab === "email" && <EmailSettingsPanel />}
      {activeTab === "email-templates" && <EmailTemplatesPanel />}
      {activeTab === "feriados" && <FeriadosPanel />}
      {activeTab === "seguranca" && role === "ADMIN" && <SecuritySettingsPanel />}
      {activeTab === "permissoes" && role === "ADMIN" && <PermissionsPanel />}
    </div>
  );
}
