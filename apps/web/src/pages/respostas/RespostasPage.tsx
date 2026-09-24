import { useState } from "react";
import { Slash, LogOut, ArrowRightLeft, UserCheck } from "lucide-react";
import { PERMISSION, type Permission } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { RespostasRapidasTab } from "./RespostasRapidasTab";
import { EncerramentoTab } from "./EncerramentoTab";
import { AutoMessageTab } from "./AutoMessageTab";

type Tab = "rapidas" | "encerramento" | "transferencia" | "aceite";

// "rapidas" needs no entry — reaching /respostas at all already requires the
// RESPOSTAS_RAPIDAS_GERENCIAR umbrella (see Sidebar's MENU_ITEMS), so that
// tab has nothing further to gate. The other three each sit behind their own
// finer permission on top of that umbrella — see PROMPT: "Mapeie todos os
// menus e o que tem dentro dos menus e inclua nas permissões".
const TAB_PERMISSION: Partial<Record<Tab, Permission>> = {
  encerramento: PERMISSION.RESPOSTAS_ENCERRAMENTO_GERENCIAR,
  transferencia: PERMISSION.RESPOSTAS_TRANSFERENCIA_GERENCIAR,
  aceite: PERMISSION.RESPOSTAS_ACEITE_GERENCIAR,
};

const TABS: { key: Tab; label: string; icon: typeof Slash }[] = [
  { key: "rapidas", label: "Respostas rápidas", icon: Slash },
  { key: "encerramento", label: "Encerramento", icon: LogOut },
  { key: "transferencia", label: "Transferência", icon: ArrowRightLeft },
  { key: "aceite", label: "Aceite", icon: UserCheck },
];

export default function RespostasPage() {
  const [tab, setTab] = useState<Tab>("rapidas");
  const permissions = useAuthStore((s) => s.permissions);
  const visibleTabs = TABS.filter((t) => {
    const permission = TAB_PERMISSION[t.key];
    return !permission || permissions?.[permission];
  });

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex overflow-x-auto border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 py-3 text-sm font-medium sm:flex-none sm:px-6 ${
              tab === t.key ? "border-b-2 border-primary text-primary" : "text-muted"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "rapidas" && <RespostasRapidasTab />}
        {tab === "encerramento" && <EncerramentoTab />}
        {tab === "transferencia" && (
          <AutoMessageTab
            trigger="TRANSFER"
            description="Mensagem enviada automaticamente pelo sistema ao cliente quando a conversa é transferida para outro atendente."
            emptyMessage="Nenhuma mensagem de transferência cadastrada ainda."
          />
        )}
        {tab === "aceite" && (
          <AutoMessageTab
            trigger="ACCEPT"
            description="Mensagem enviada automaticamente pelo sistema ao cliente quando um atendente aceita a conversa."
            emptyMessage="Nenhuma mensagem de aceite cadastrada ainda."
          />
        )}
      </div>
    </div>
  );
}
