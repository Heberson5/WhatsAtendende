import { useState } from "react";
import { Slash, LogOut } from "lucide-react";
import { RespostasRapidasTab } from "./RespostasRapidasTab";
import { EncerramentoTab } from "./EncerramentoTab";

export default function RespostasPage() {
  const [tab, setTab] = useState<"rapidas" | "encerramento">("rapidas");

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex border-b border-border">
        <button
          onClick={() => setTab("rapidas")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium sm:flex-none sm:px-6 ${
            tab === "rapidas" ? "border-b-2 border-primary text-primary" : "text-muted"
          }`}
        >
          <Slash className="h-4 w-4" /> Respostas rápidas
        </button>
        <button
          onClick={() => setTab("encerramento")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium sm:flex-none sm:px-6 ${
            tab === "encerramento" ? "border-b-2 border-primary text-primary" : "text-muted"
          }`}
        >
          <LogOut className="h-4 w-4" /> Encerramento
        </button>
      </div>

      <div className="flex-1 overflow-hidden">{tab === "rapidas" ? <RespostasRapidasTab /> : <EncerramentoTab />}</div>
    </div>
  );
}
