import { useState } from "react";
import { Slash, LogOut, ArrowRightLeft, UserCheck } from "lucide-react";
import { RespostasRapidasTab } from "./RespostasRapidasTab";
import { EncerramentoTab } from "./EncerramentoTab";
import { AutoMessageTab } from "./AutoMessageTab";

type Tab = "rapidas" | "encerramento" | "transferencia" | "aceite";

const TABS: { key: Tab; label: string; icon: typeof Slash }[] = [
  { key: "rapidas", label: "Respostas rápidas", icon: Slash },
  { key: "encerramento", label: "Encerramento", icon: LogOut },
  { key: "transferencia", label: "Transferência", icon: ArrowRightLeft },
  { key: "aceite", label: "Aceite", icon: UserCheck },
];

export default function RespostasPage() {
  const [tab, setTab] = useState<Tab>("rapidas");

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex overflow-x-auto border-b border-border">
        {TABS.map((t) => (
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
