import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { FlowListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";

interface OfficialConnectionOption {
  id: string;
  name: string;
  connectionMode: "QRCODE" | "OFFICIAL_API";
}

export function FlowFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: connections } = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: async () => (await api.get<OfficialConnectionOption[]>("/whatsapp/connections")).data,
  });
  const officialConnections = connections?.filter((c) => c.connectionMode === "OFFICIAL_API") ?? [];

  const createMutation = useMutation({
    mutationFn: () => api.post<FlowListItemDTO>("/flows", { name: name.trim(), description: description.trim() || undefined, connectionIds }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Fluxo criado.");
      onCreated(res.data.id);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  function toggleConnection(id: string) {
    setConnectionIds((ids) => (ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-card border border-border bg-surface p-5 shadow-elevated">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Novo fluxo</h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Nome</span>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Boas-vindas, Suporte nível 1..."
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Descrição (opcional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Para que serve este fluxo"
              className="focus-ring w-full resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Conexões WhatsApp Oficial</span>
            <p className="mb-1.5 text-xs text-muted">O fluxo só responde automaticamente nas conexões marcadas aqui. Pode ficar sem nenhuma por enquanto.</p>
            <div className="max-h-40 overflow-y-auto rounded-card border border-border">
              {officialConnections.length === 0 && <p className="p-3 text-center text-xs text-muted">Nenhuma conexão WhatsApp Oficial cadastrada ainda.</p>}
              {officialConnections.map((c) => (
                <label key={c.id} className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-surface-alt">
                  <input type="checkbox" checked={connectionIds.includes(c.id)} onChange={() => toggleConnection(c.id)} className="h-4 w-4 accent-primary" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="mt-3 rounded-card bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            {createMutation.isPending ? "Criando..." : "Criar e abrir"}
          </button>
        </div>
      </form>
    </div>
  );
}
