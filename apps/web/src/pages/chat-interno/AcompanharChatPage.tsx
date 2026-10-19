import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import type { ChatMemberDTO, ChatMessageDTO, ChatRoomKind } from "@whatsatendende/types";
import { api } from "../../lib/api";
import { ChatAttachment } from "../../components/internal-chat/ChatAttachment";
import { RoomIcon } from "../../components/internal-chat/ChatAvatar";

interface OversightRoom {
  id: string;
  kind: ChatRoomKind;
  name: string;
  members: ChatMemberDTO[];
  lastMessageAt: string | null;
}

/** Gestão › Chat interno: read every conversation of the team, with no sign to who is talking. Each read is audited. */
export default function AcompanharChatPage() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const { data: rooms } = useQuery({ queryKey: ["internal-chat-oversight"], queryFn: async () => (await api.get<OversightRoom[]>("/internal-chat/oversight/rooms")).data });
  const { data: messages } = useQuery({
    queryKey: ["internal-chat-oversight", roomId],
    queryFn: async () => (await api.get<ChatMessageDTO[]>(`/internal-chat/oversight/rooms/${roomId}/messages`)).data,
    enabled: Boolean(roomId),
  });
  const room = rooms?.find((r) => r.id === roomId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start gap-2 border-b border-warning bg-warning-soft px-4 py-2.5 text-xs">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          Quem conversa não é avisado desta leitura. Cada conversa aberta aqui fica registrada na auditoria (só o administrador vê). Use somente conforme a política
          interna da empresa e a LGPD, para fins de gestão e segurança.
        </p>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={clsx("w-full overflow-y-auto border-r border-border md:w-72 md:shrink-0", roomId && "hidden md:block")}>
          {rooms?.length === 0 && <p className="p-4 text-sm text-muted">Nenhuma conversa ainda.</p>}
          {rooms?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoomId(r.id)}
              className={clsx("flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt", r.id === roomId && "bg-primary/[0.07]")}
            >
              <RoomIcon kind={r.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {r.members.length} membros{r.lastMessageAt && ` · ${format(new Date(r.lastMessageAt), "dd/MM HH:mm")}`}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className={clsx("min-w-0 flex-1 flex-col", roomId ? "flex" : "hidden md:flex")}>
          {room ? (
            <>
              <div className="border-b border-border px-4 py-2.5">
                <button onClick={() => setRoomId(null)} className="mb-1 text-xs text-primary md:hidden">
                  ← Voltar
                </button>
                <p className="text-sm font-semibold">{room.name}</p>
                <p className="truncate text-xs text-muted">{room.members.map((m) => m.name).join(", ")}</p>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {messages?.map((m) =>
                  m.authorId ? (
                    <div key={m.id} className="max-w-[80%] rounded-card bg-surface-alt px-3 py-1.5 text-sm">
                      <p className="text-[11px] font-semibold opacity-80">{m.authorName}</p>
                      {m.attachment && <ChatAttachment attachment={m.attachment} />}
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {m.conversation && <p className="text-xs text-muted">Citou a conversa de {m.conversation.contactName}</p>}
                      <p className="text-right text-[10px] text-muted">{format(new Date(m.createdAt), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                  ) : (
                    <p key={m.id} className="text-center text-[11px] text-muted">
                      {m.body} · {format(new Date(m.createdAt), "dd/MM HH:mm")}
                    </p>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Escolha uma conversa para ler</div>
          )}
        </div>
      </div>
    </div>
  );
}
