import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import type { ConversationListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { contactDisplayName } from "../../lib/contact-display";

interface AgentOption {
  id: string;
  displayName: string;
  presence: "ONLINE" | "AWAY" | "OFFLINE";
  status: "ACTIVE" | "INACTIVE";
  whatsappConnectionName: string | null;
}

const PRESENCE_DOT: Record<string, string> = { ONLINE: "bg-green-500", AWAY: "bg-yellow-500", OFFLINE: "bg-gray-400" };
const PRESENCE_LABEL: Record<string, string> = { ONLINE: "Online", AWAY: "Ausente", OFFLINE: "Offline" };

/**
 * MANAGER/ADMIN routing a conversation straight from Gestão — to a chosen
 * agent, from any still-active status (including one nobody has ever
 * claimed, or a customer parked in HANDLED_EXTERNALLY). See PROMPT: "No
 * menu gestão, precisa ter a opção de transferir para algum atendente ou
 * enviar para fila."
 */
export function GestaoTransferModal({
  conversation,
  onClose,
  onTransferred,
}: {
  conversation: ConversationListItemDTO;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingOffline, setConfirmingOffline] = useState(false);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents")).data,
  });
  const activeAgents = (agents ?? []).filter((a) => a.status === "ACTIVE");
  const selectedAgent = activeAgents.find((a) => a.id === selected) ?? null;

  const transferMutation = useMutation({
    mutationFn: (toAgentId: string) => api.post(`/conversations/${conversation.id}/gestao-transfer`, { toAgentId }),
    onSuccess: () => {
      toast.success(`Conversa transferida para ${selectedAgent?.displayName ?? "o atendente"}.`);
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
      onTransferred();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  function handleConfirmClick() {
    if (!selectedAgent) return;
    if (selectedAgent.presence !== "ONLINE" && !confirmingOffline) {
      setConfirmingOffline(true);
      return;
    }
    transferMutation.mutate(selectedAgent.id);
  }

  const displayName = contactDisplayName(conversation.contact);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-5 shadow-elevated">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Transferir para um atendente</h2>
          <button onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          Conversa de <strong>{displayName}</strong>
          {conversation.assignedAgentName ? <> — atualmente com {conversation.assignedAgentName}</> : null}.
        </p>

        <div className="max-h-64 overflow-y-auto rounded-card border border-border">
          {activeAgents.length === 0 && <p className="p-4 text-center text-xs text-muted">Nenhum atendente disponível.</p>}
          {activeAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                setSelected(agent.id);
                setConfirmingOffline(false);
              }}
              disabled={agent.id === conversation.assignedAgentId}
              className={`focus-ring flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50 ${
                selected === agent.id ? "bg-primary/5" : ""
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${PRESENCE_DOT[agent.presence]}`} />
              <span className="min-w-0 flex-1 truncate text-sm">{agent.displayName}</span>
              <span className="shrink-0 text-xs text-muted">
                {agent.id === conversation.assignedAgentId ? "Atendente atual" : PRESENCE_LABEL[agent.presence]}
                {agent.whatsappConnectionName ? ` · ${agent.whatsappConnectionName}` : ""}
              </span>
            </button>
          ))}
        </div>

        {confirmingOffline && selectedAgent && (
          <div className="mt-3 flex items-start gap-2 rounded-card bg-secondary/30 px-3 py-2 text-sm text-text">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{selectedAgent.displayName}</strong> está offline agora. Tem certeza que deseja transferir mesmo assim?
            </span>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={!selected || transferMutation.isPending}
            className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            {transferMutation.isPending ? "Transferindo..." : confirmingOffline ? "Sim, transferir mesmo assim" : "Transferir"}
          </button>
        </div>
      </div>
    </div>
  );
}
