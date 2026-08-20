import { useState } from "react";
import { WhatsAppConnectionPanel } from "./WhatsAppConnectionPanel";
import { BrandingPanel } from "./BrandingPanel";
import { EmailSettingsPanel } from "./EmailSettingsPanel";

type Tab = "whatsapp" | "branding" | "email";

const TABS: { key: Tab; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "branding", label: "Identidade visual" },
  { key: "email", label: "E-mail" },
];

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("whatsapp");

  return (
    <div className="h-full overflow-auto p-6">
      <div className="shadow-soft mb-6 flex w-fit gap-1 rounded-card border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-card px-4 py-2 text-sm font-medium ${tab === t.key ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "whatsapp" && <WhatsAppConnectionPanel />}
      {tab === "branding" && <BrandingPanel />}
      {tab === "email" && <EmailSettingsPanel />}
    </div>
  );
}
