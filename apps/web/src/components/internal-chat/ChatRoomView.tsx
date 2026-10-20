import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import clsx from "clsx";
import { ArrowLeft, Check, CheckCheck, Link2, Paperclip, Send, Settings2, Smile } from "lucide-react";
import type { ChatMessageDTO, ChatRoomDTO, ConversationListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { contactDisplayName } from "../../lib/contact-display";
import { useAuthStore } from "../../store/auth-store";
import { useInternalChatStore } from "../../store/internal-chat-store";
import { renderWhatsAppFormatting } from "../../lib/whatsappFormatting";
import { ChatAttachment } from "./ChatAttachment";
import { GroupSettings } from "./GroupSettings";

const EMOJIS = ["😀", "😂", "😊", "😍", "👍", "👏", "🙏", "🎉", "✅", "❤️", "😅", "🤔", "😢", "🔥", "👀", "☕"];
const TYPING_THROTTLE_MS = 3_000;
// Same as the customer conversation's Composer: the box grows with the text up to this many lines, then scrolls.
const MAX_TEXTAREA_LINES = 10;

/** One message, or a system line ("Ana saiu do grupo"), with ✓✓ on the sender's own messages once everyone read it. */
function MessageRow({ message, mine, onOpenConversation }: { message: ChatMessageDTO; mine: boolean; onOpenConversation: (id: string) => void }) {
  if (!message.authorId) return <p className="py-1 text-center text-[11px] text-muted">{message.body}</p>;
  return (
    <div className={clsx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[80%] space-y-1 rounded-card px-3 py-1.5 text-sm", mine ? "bg-primary text-primary-fg" : "bg-surface-alt")}>
        {!mine && <p className="text-[11px] font-semibold opacity-80">{message.authorName}</p>}
        {message.attachment && <ChatAttachment attachment={message.attachment} />}
        {message.body && <p className="whitespace-pre-wrap break-words">{renderWhatsAppFormatting(message.body)}</p>}
        {message.conversation && (
          <button
            type="button"
            onClick={() => onOpenConversation(message.conversation!.id)}
            className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium underline", mine ? "bg-white/15" : "bg-surface")}
          >
            <Link2 className="h-3 w-3" /> Conversa de {message.conversation.contactName}
          </button>
        )}
        <p className="flex items-center justify-end gap-1 text-[10px] opacity-70">
          {format(new Date(message.createdAt), "dd/MM HH:mm")}
          {mine && (message.readByAll ? <CheckCheck className="h-3 w-3 text-[var(--color-read-receipt)]" /> : <Check className="h-3 w-3" />)}
        </p>
      </div>
    </div>
  );
}

export function ChatRoomView({ room, onBack }: { room: ChatRoomDTO; onBack: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const typing = useInternalChatStore((s) => s.typing[room.id]);
  const setOpen = useInternalChatStore((s) => s.setOpen);
  const [text, setText] = useState("");
  const [linkedConversation, setLinkedConversation] = useState<ConversationListItemDTO | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [, setTick] = useState(0);
  const lastTypingSent = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["internal-chat", "messages", room.id],
    queryFn: async () => (await api.get<ChatMessageDTO[]>(`/internal-chat/rooms/${room.id}/messages`)).data,
  });
  const { data: myConversations } = useQuery({
    queryKey: ["mine"],
    queryFn: async () => (await api.get<ConversationListItemDTO[]>("/conversations/mine")).data,
    enabled: showLink,
  });

  // Opening the room (and every new message while it's open) marks it as read — that's what turns the sender's ✓ into ✓✓.
  useEffect(() => {
    api
      .post(`/internal-chat/rooms/${room.id}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["internal-chat", "rooms"] }))
      .catch(() => undefined);
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [room.id, messages?.length, queryClient]);

  // Re-render once the "digitando…" window is over.
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, typing.until - Date.now()));
    return () => clearTimeout(timer);
  }, [typing]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["internal-chat"] });
  const sendMutation = useMutation({
    mutationFn: () => api.post(`/internal-chat/rooms/${room.id}/messages`, { body: text || undefined, conversationId: linkedConversation?.id }),
    onSuccess: () => {
      setText("");
      setLinkedConversation(null);
      refresh();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });
  const fileMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (text.trim()) form.append("body", text.trim());
      return api.post(`/internal-chat/rooms/${room.id}/files`, form);
    },
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = parseFloat(getComputedStyle(el).lineHeight || "20") * MAX_TEXTAREA_LINES;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text]);

  function onType(value: string) {
    setText(value);
    if (Date.now() - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = Date.now();
      api.post(`/internal-chat/rooms/${room.id}/typing`).catch(() => undefined);
    }
  }

  function openConversation(conversationId: string) {
    const mine = myConversations?.some((c) => c.id === conversationId) ?? true;
    setOpen(false);
    navigate(mine ? `/atendimento?open=${conversationId}` : `/gestao?open=${conversationId}`);
  }

  const canSend = (text.trim() || linkedConversation) && !sendMutation.isPending;
  const subtitle =
    room.kind === "DIRECT" && room.peer
      ? room.peer.presence === "ONLINE"
        ? "online"
        : room.peer.presence === "AWAY"
          ? "ausente"
          : "offline"
      : `${room.members.length} membros · ${room.members.filter((m) => m.presence === "ONLINE").length} online`;

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button onClick={onBack} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt md:hidden" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{room.name}</p>
          <p className="truncate text-[11px] text-muted">{typing && typing.until > Date.now() ? `${typing.name} está digitando…` : subtitle}</p>
        </div>
        {room.kind === "GROUP" && (
          <button onClick={() => setShowSettings(true)} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Membros do grupo" title="Membros do grupo">
            <Settings2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages?.length === 0 && <p className="pt-6 text-center text-xs text-muted">Nenhuma mensagem ainda.</p>}
        {messages?.map((m) => (
          <MessageRow key={m.id} message={m} mine={m.authorId === userId} onOpenConversation={openConversation} />
        ))}
        <div ref={bottomRef} />
      </div>

      {linkedConversation && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-alt px-3 py-1.5 text-xs">
          <span className="truncate">
            <Link2 className="mr-1 inline h-3 w-3" />
            Conversa de {contactDisplayName(linkedConversation.contact)}
          </span>
          <button onClick={() => setLinkedConversation(null)} className="text-muted hover:underline">
            remover
          </button>
        </div>
      )}
      {showLink && (
        <div className="max-h-40 overflow-y-auto border-t border-border bg-surface">
          {(myConversations ?? []).length === 0 && <p className="px-3 py-2 text-xs text-muted">Você não tem conversas em atendimento.</p>}
          {myConversations?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setLinkedConversation(c);
                setShowLink(false);
              }}
              className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-surface-alt"
            >
              {contactDisplayName(c.contact)}
            </button>
          ))}
        </div>
      )}
      {showEmoji && (
        <div className="flex flex-wrap gap-1 border-t border-border bg-surface px-3 py-2">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => setText((t) => t + e)} className="rounded p-1 text-lg hover:bg-surface-alt">
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 border-t border-border px-2 py-2">
        <button type="button" onClick={() => setShowEmoji((v) => !v)} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Emojis">
          <Smile className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Anexar arquivo">
          <Paperclip className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => setShowLink((v) => !v)} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Citar conversa de cliente" title="Citar conversa de cliente">
          <Link2 className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) fileMutation.mutate(file);
            e.target.value = "";
          }}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) sendMutation.mutate();
            }
          }}
          rows={1}
          placeholder="Mensagem para a equipe"
          className="focus-ring min-h-[2.25rem] flex-1 resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => sendMutation.mutate()}
          disabled={!canSend}
          className="focus-ring rounded-full bg-primary p-2 text-primary-fg disabled:opacity-50"
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {showSettings && <GroupSettings room={room} onClose={() => setShowSettings(false)} onLeft={onBack} />}
    </div>
  );
}
