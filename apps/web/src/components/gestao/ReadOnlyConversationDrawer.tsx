import { useQuery } from "@tanstack/react-query";
import { X, Phone } from "lucide-react";
import type { ConversationListItemDTO, MessageDTO, PaginatedResult } from "@whatsatendende/types";
import { api } from "../../lib/api";
import { MessageBubble } from "../atendimento/MessageBubble";

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
  const messageById = new Map((data?.items ?? []).map((m) => [m.id, m]));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      {/* Mirrors ChatPanel's own header/message-list styling so oversight
          shows a conversation exactly as it looks in Atendimento — just
          without the composer, since gestores only watch. */}
      <div className="flex h-full w-full max-w-lg flex-col bg-surface shadow-elevated">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-alt text-sm font-semibold text-muted">
              {conversation.contact.photoUrl ? (
                <img src={conversation.contact.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">{displayName.slice(0, 2).toUpperCase()}</div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="flex items-center gap-1 text-xs text-muted">
                <Phone className="h-3 w-3" /> {conversation.contact.phone} · Atendente: {conversation.assignedAgentName ?? "-"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="focus-ring shrink-0 rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-bg)] px-4 py-4">
          {isLoading && <p className="text-center text-sm text-muted">Carregando histórico...</p>}
          {data?.items.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              readOnly
              onReply={() => undefined}
              onReact={() => undefined}
              repliedMessage={m.replyToMessageId ? messageById.get(m.replyToMessageId) : undefined}
            />
          ))}
        </div>

        <div className="border-t border-border px-5 py-3 text-center text-xs text-muted">
          Modo de visualização — gestores não podem interagir nesta conversa.
        </div>
      </div>
    </div>
  );
}
