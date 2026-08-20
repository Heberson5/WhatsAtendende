import { useState } from "react";
import { WhatsAppConnectionPanel } from "./WhatsAppConnectionPanel";
import { BrandingPanel } from "./BrandingPanel";

type Tab = "whatsapp" | "branding";

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>("whatsapp");

  return (
    <div className="h-full overflow-auto p-6">
      <div className="shadow-soft mb-6 flex w-fit gap-1 rounded-card border border-border bg-surface p-1">
        <button
          onClick={() => setTab("whatsapp")}
          className={`rounded-card px-4 py-2 text-sm font-medium ${tab === "whatsapp" ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt"}`}
        >
          WhatsApp
        </button>
        <button
          onClick={() => setTab("branding")}
          className={`rounded-card px-4 py-2 text-sm font-medium ${tab === "branding" ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt"}`}
        >
          Identidade visual
        </button>
      </div>

      {tab === "whatsapp" ? <WhatsAppConnectionPanel /> : <BrandingPanel />}
    </div>
  );
}
