import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import clsx from "clsx";
import { MessageSquarePlus, Users, X } from "lucide-react";
import type { ChatRoomDTO, ChatUserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { useInternalChatStore } from "../../store/internal-chat-store";
import { ChatRoomView } from "./ChatRoomView";
import { PersonAvatar, RoomIcon } from "./ChatAvatar";

export const chatRoomsKey = ["internal-chat", "rooms"];

export function useChatRooms() {
  return useQuery({ queryKey: chatRoomsKey, queryFn: async () => (await api.get<ChatRoomDTO[]>("/internal-chat/rooms")).data, refetchInterval: 60_000 });
}

type Picker = { mode: "direct" } | { mode: "group"; name: string; memberIds: string[] } | null;

/** The side panel: #Geral, groups and direct conversations on the left, the open one on the right. */
export function InternalChatDrawer() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user?.id);
  const { setOpen, activeRoomId, setActiveRoom } = useInternalChatStore();
  const { data: rooms } = useChatRooms();
  const [picker, setPicker] = useState<Picker>(null);
  const { data: users } = useQuery({
    queryKey: ["internal-chat", "users"],
    queryFn: async () => (await api.get<ChatUserDTO[]>("/internal-chat/users")).data,
    enabled: picker !== null,
  });

  const onOpened = (room: ChatRoomDTO) => {
    queryClient.invalidateQueries({ queryKey: chatRoomsKey });
    setActiveRoom(room.id);
    setPicker(null);
  };
  const onError = (err: unknown) => toast.error(getApiErrorMessage(err));
  const directMutation = useMutation({ mutationFn: async (userId: string) => (await api.post<ChatRoomDTO>("/internal-chat/direct", { userId })).data, onSuccess: onOpened, onError });
  const groupMutation = useMutation({
    mutationFn: async (input: { name: string; memberIds: string[] }) => (await api.post<ChatRoomDTO>("/internal-chat/groups", input)).data,
    onSuccess: onOpened,
    onError,
  });

  const active = rooms?.find((r) => r.id === activeRoomId) ?? null;
  const others = (users ?? []).filter((u) => u.id !== me);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-full max-w-3xl overflow-hidden border-l border-border bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        aria-label="Chat interno"
      >
        <div className={clsx("flex w-full flex-col border-r border-border md:w-64 md:shrink-0", active && "hidden md:flex")}>
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-semibold">Chat interno</h2>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setPicker({ mode: "direct" })} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" title="Nova conversa" aria-label="Nova conversa">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button onClick={() => setPicker({ mode: "group", name: "", memberIds: [] })} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" title="Novo grupo" aria-label="Novo grupo">
                <Users className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar chat interno">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {picker && (
            <div className="space-y-2 border-b border-border bg-surface-alt p-3 text-sm">
              <p className="text-xs font-semibold">{picker.mode === "direct" ? "Conversar com" : "Novo grupo"}</p>
              {picker.mode === "group" && (
                <input
                  autoFocus
                  value={picker.name}
                  onChange={(e) => setPicker({ ...picker, name: e.target.value })}
                  placeholder="Nome do grupo"
                  className="focus-ring w-full rounded-card border border-border bg-surface px-2 py-1 text-sm"
                />
              )}
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {others.map((u) => {
                  const selected = picker.mode === "group" && picker.memberIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        picker.mode === "direct"
                          ? directMutation.mutate(u.id)
                          : setPicker({ ...picker, memberIds: selected ? picker.memberIds.filter((x) => x !== u.id) : [...picker.memberIds, u.id] })
                      }
                      className={clsx("flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-surface", selected && "bg-primary/10 font-semibold")}
                    >
                      <PersonAvatar name={u.name} photoUrl={u.photoUrl} presence={u.presence} size="sm" />
                      <span className="truncate">{u.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPicker(null)} className="rounded px-2 py-1 text-xs hover:bg-surface">
                  Cancelar
                </button>
                {picker.mode === "group" && (
                  <button
                    onClick={() => groupMutation.mutate({ name: picker.name.trim(), memberIds: picker.memberIds })}
                    disabled={!picker.name.trim() || picker.memberIds.length === 0 || groupMutation.isPending}
                    className="rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-fg disabled:opacity-60"
                  >
                    Criar grupo
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {rooms?.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setActiveRoom(room.id)}
                className={clsx("flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt", room.id === activeRoomId && "bg-primary/[0.07]")}
              >
                {room.kind === "DIRECT" && room.peer ? <PersonAvatar name={room.peer.name} photoUrl={room.peer.photoUrl} presence={room.peer.presence} /> : <RoomIcon kind={room.kind} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-1">
                    <span className={clsx("truncate text-sm", room.unreadCount > 0 ? "font-bold" : "font-medium")}>{room.name}</span>
                    {room.lastMessage && (
                      <span className="shrink-0 text-[10px] text-muted">{formatDistanceToNowStrict(new Date(room.lastMessage.createdAt), { locale: ptBR })}</span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs text-muted">
                      {room.lastMessage ? `${room.lastMessage.authorName ? `${room.lastMessage.authorName}: ` : ""}${room.lastMessage.body}` : "Sem mensagens"}
                    </span>
                    {room.unreadCount > 0 && (
                      <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg">{room.unreadCount}</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        {active ? (
          <ChatRoomView key={active.id} room={active} onBack={() => setActiveRoom(null)} />
        ) : (
          <div className="hidden flex-1 items-center justify-center text-sm text-muted md:flex">Escolha uma conversa</div>
        )}
      </aside>
    </div>
  );
}
