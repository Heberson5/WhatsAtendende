import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../../lib/api";

interface AgentOption {
  id: string;
  displayName: string;
  presence: "ONLINE" | "AWAY" | "OFFLINE";
}

const PRESENCE_DOT: Record<string, string> = { ONLINE: "bg-green-500", AWAY: "bg-yellow-500", OFFLINE: "bg-gray-400" };

export function TransferModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (agentId: string, note: string) => Promise<void>;
}) {
  const { data: agents } = useQuery({
    queryKey: ["transfer-targets"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents/transfer-targets")).data,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    if (!selected) return;
    setLoading(true);
    try {
      await onConfirm(selected, note);
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Transferir atendimento</h2>
          <button onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-56 space-y-1 overflow-y-auto">
          {agents?.length === 0 && <p className="text-sm text-muted">Nenhum outro atendente disponível.</p>}
          {agents?.map((agent) => (
            <label
              key={agent.id}
              className="focus-ring flex cursor-pointer items-center gap-3 rounded-card px-3 py-2 hover:bg-surface-alt"
            >
              <input type="radio" name="agent" checked={selected === agent.id} onChange={() => setSelected(agent.id)} />
              <span className={`h-2 w-2 rounded-full ${PRESENCE_DOT[agent.presence]}`} />
              <span className="text-sm">{agent.displayName}</span>
            </label>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium">Observação (opcional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          className="focus-ring mt-1 w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
          placeholder="Motivo da transferência..."
        />

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || loading}
            className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            {loading ? "Transferindo..." : "Confirmar transferência"}
          </button>
        </div>
      </div>
    </div>
  );
}
