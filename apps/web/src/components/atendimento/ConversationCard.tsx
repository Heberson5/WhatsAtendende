import clsx from "clsx";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Facebook, Instagram, type LucideIcon } from "lucide-react";
import type { Channel, ConversationListItemDTO } from "@whatsatendende/types";
import { contactDisplayName } from "../../lib/contact-display";
import { formatPhone } from "../../lib/format-phone";
import { useNow } from "../../hooks/useNow";

// Customer waiting this long for a reply gets the "sem resposta" warning;
// past the second threshold it turns red.
export const NO_REPLY_WARNING_MINUTES = 5;
export const NO_REPLY_DANGER_MINUTES = 15;

function shortTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "ontem";
  return format(d, "dd/MM");
}

export function minutesWaiting(conversation: ConversationListItemDTO, now: number) {
  return conversation.awaitingReplySince ? Math.floor((now - new Date(conversation.awaitingReplySince).getTime()) / 60_000) : 0;
}

// null = no icon, just the colored dot (WhatsApp's original look, unchanged).
const CHANNEL_ICON: Record<Channel, LucideIcon | null> = {
  WHATSAPP: null,
  INSTAGRAM: Instagram,
  MESSENGER: Facebook,
};

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function ConversationCard({
  conversation,
  selected,
  onSelect,
  onAccept,
  accepting,
  agentPaused,
  transferredOutView,
}: {
  conversation: ConversationListItemDTO;
  selected?: boolean;
  onSelect?: () => void;
  onAccept?: () => void;
  accepting?: boolean;
  // See PROMPT: "quando estiver pausado, não permitirá aceitar novas
  // conversas, só poderá responder as existentes" — mirrors the backend
  // check in acceptConversation, disabled client-side first so the agent
  // never has to find out by watching the click fail.
  agentPaused?: boolean;
  // "Transferidas" tab: this agent's own transfer is the point of the
  // card, so the badge and timestamp read from conversation.transfer
  // (who *I* sent it to, and when) instead of the usual "who sent it to
  // me" badge and the last-message timestamp.
  transferredOutView?: boolean;
}) {
  const now = useNow();
  const displayName = contactDisplayName(conversation.contact, conversation.channel);
  const ChannelIcon = CHANNEL_ICON[conversation.channel];
  // When there's a saved name, displayName hides the phone entirely — show
  // it as a subtitle too, since the phone number is what an agent actually
  // needs to confirm/dial/search by.
  const showPhoneSubtitle = Boolean(conversation.contact.name && conversation.contact.phone);
  // A disconnected connection can't actually deliver anything — accepting
  // from here would just leave the customer with no reply possible.
  const connectionDisconnected = conversation.whatsappConnectionStatus !== "CONNECTED";
  const waitingMinutes = transferredOutView ? 0 : minutesWaiting(conversation, now);
  const noReply = waitingMinutes >= NO_REPLY_WARNING_MINUTES;
  const noReplyDanger = waitingMinutes >= NO_REPLY_DANGER_MINUTES;
  const timeLabel = noReply
    ? `há ${formatDistanceToNow(new Date(conversation.awaitingReplySince!), { locale: ptBR })}`
    : onAccept
      ? formatDistanceToNow(new Date(conversation.enteredQueueAt), { locale: ptBR })
      : shortTime(transferredOutView && conversation.transfer ? conversation.transfer.at : conversation.lastMessageAt);

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => onSelect && e.key === "Enter" && onSelect()}
      aria-current={selected ? "true" : undefined}
      className={clsx(
        "focus-ring relative flex items-start gap-3 border-b border-border px-3 py-3 transition-colors",
        onSelect && "cursor-pointer",
        selected ? "bg-primary/[0.07]" : "hover:bg-surface-alt"
      )}
    >
      {selected && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-primary" aria-hidden />}
      <div className="relative shrink-0">
        {conversation.contact.photoUrl ? (
          <img src={conversation.contact.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
            {initials(displayName)}
          </div>
        )}
        {conversation.isNew && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-secondary" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={clsx("truncate text-[13.5px]", conversation.unreadCount > 0 ? "font-bold" : "font-semibold")}>{displayName}</p>
          <span
            className={clsx(
              "shrink-0 text-[11px]",
              noReplyDanger ? "font-semibold text-danger" : noReply ? "font-semibold text-warning" : "text-muted"
            )}
          >
            {timeLabel}
          </span>
        </div>

        {showPhoneSubtitle && <p className="truncate text-[11.5px] tabular-nums text-muted">{formatPhone(conversation.contact.phone!)}</p>}
        {conversation.lastMessagePreview ? (
          <p className={clsx("truncate text-xs", conversation.unreadCount > 0 ? "font-medium text-[var(--color-text)]" : "text-muted")}>
            {conversation.lastMessagePreview}
          </p>
        ) : showPhoneSubtitle ? null : (
          <p className="text-xs text-muted">{onAccept ? "Nova conversa" : "Em atendimento"}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted">
            {ChannelIcon ? (
              <ChannelIcon className="h-3 w-3 shrink-0" style={{ color: conversation.whatsappConnectionColor }} />
            ) : (
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: conversation.whatsappConnectionColor }} />
            )}
            <span className="truncate">{conversation.whatsappConnectionName}</span>
          </span>
          {conversation.transfer && (
            <span className="inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-[10.5px] font-semibold text-info">
              {transferredOutView ? `para ${conversation.transfer.toAgentName}` : `de ${conversation.transfer.fromAgentName}`}
            </span>
          )}
          {connectionDisconnected && (
            <span className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-semibold text-danger">Conexão desconectada</span>
          )}
          {noReply && (
            <span
              className={clsx(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                noReplyDanger ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
              )}
            >
              sem resposta
            </span>
          )}
          {conversation.unreadCount > 0 && (
            <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-fg">
              {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
            </span>
          )}
        </div>

        {onAccept && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccept();
            }}
            disabled={accepting || connectionDisconnected || agentPaused}
            title={
              agentPaused
                ? "Você está pausado — retome o atendimento para aceitar conversas"
                : connectionDisconnected
                  ? "Conexão desconectada — não é possível aceitar conversas"
                  : undefined
            }
            className="focus-ring mt-2 w-full rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
          >
            {accepting ? "Aceitando..." : agentPaused ? "Você está pausado" : connectionDisconnected ? "Conexão desconectada" : "Aceitar"}
          </button>
        )}
      </div>
    </div>
  );
}
