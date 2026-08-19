import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { format } from "date-fns";
import type { ConversationListItemDTO, MessageDTO, PaginatedResult } from "@whatsatendende/types";
import { api } from "../../lib/api";

export function ReadOnlyConversationDrawer({
  conversation,
  onClose,
}: {
  conversation: ConversationListItemDTO;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["oversight-messages", conversation.id],
    queryFn: async () =>
      (await api.get<PaginatedResult<MessageDTO>>(`/messages/conversations/${conversation.id}`, { params: { limit: 50 } })).data,
  });

  const displayName = conversation.contact.name || conversation.contact.phone;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-lg flex-col bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{displayName}</h2>
            <p className="text-xs text-muted">
              {conversation.contact.phone} · Atendente: {conversation.assignedAgentName ?? "-"}
            </p>
          </div>
          <button onClick={onClose} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-bg)] px-5 py-4">
          {isLoading && <p className="text-center text-sm text-muted">Carregando histórico...</p>}
          {data?.items.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${
                  m.direction === "OUTBOUND" ? "bg-primary text-primary-fg" : "bg-surface-alt"
                }`}
              >
                {m.senderAgentDisplayName && <p className="mb-0.5 text-xs font-bold opacity-90">{m.senderAgentDisplayName}</p>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments.map((a) => (
                  <p key={a.id} className="text-xs opacity-90">
                    📎 {a.fileName}
                  </p>
                ))}
                <p className="mt-1 text-[11px] opacity-75">{format(new Date(m.createdAt), "dd/MM HH:mm")}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border px-5 py-3 text-center text-xs text-muted">
          Modo de visualização — gestores não podem interagir nesta conversa.
        </div>
      </div>
    </div>
  );
}
