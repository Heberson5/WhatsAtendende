import clsx from "clsx";
import { format } from "date-fns";
import { Check, CheckCheck, Clock, FileText, MapPin, ReplyIcon, Smile, Trash2, User } from "lucide-react";
import type { MessageDTO, MessageAttachmentDTO } from "@whatsatendende/types";
import { useState } from "react";
import { renderWhatsAppFormatting } from "../../lib/whatsappFormatting";
import { withAuthToken } from "../../lib/api";
import { MediaLightbox, type LightboxMedia } from "./MediaLightbox";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function StatusIcon({ status }: { status: MessageDTO["status"] }) {
  if (status === "PENDING") return <Clock className="h-3.5 w-3.5" />;
  if (status === "SENT") return <Check className="h-3.5 w-3.5" />;
  if (status === "DELIVERED") return <CheckCheck className="h-3.5 w-3.5" />;
  if (status === "READ") return <CheckCheck className="h-3.5 w-3.5 text-blue-400" />;
  return <span className="text-red-400">!</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function vcardName(vcard: string | undefined, fallback: string): string {
  const match = vcard?.match(/FN:(.+)/);
  return match?.[1]?.trim() || fallback;
}

function Attachment({ att, onOpenMedia }: { att: MessageAttachmentDTO; onOpenMedia: (media: LightboxMedia) => void }) {
  if (att.kind === "IMAGE") {
    const src = withAuthToken(att.url);
    return (
      <button type="button" onClick={() => onOpenMedia({ url: src, kind: "IMAGE", fileName: att.fileName })} className="focus-ring block">
        <img src={src} alt={att.fileName} className="max-h-64 max-w-full cursor-zoom-in rounded object-cover" />
      </button>
    );
  }
  if (att.kind === "VIDEO") {
    const src = withAuthToken(att.url);
    return (
      <button
        type="button"
        onClick={() => onOpenMedia({ url: src, kind: "VIDEO", fileName: att.fileName })}
        className="focus-ring group relative block overflow-hidden rounded"
      >
        <video src={src} className="max-h-64 max-w-full rounded" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">Abrir</span>
        </div>
      </button>
    );
  }
  if (att.kind === "AUDIO") {
    return <audio src={withAuthToken(att.url)} controls className="w-full min-w-[220px]" />;
  }
  if (att.kind === "LOCATION" && att.latitude !== undefined && att.longitude !== undefined) {
    const mapSrc = `https://staticmap.openstreetmap.de/staticmap.php?center=${att.latitude},${att.longitude}&zoom=15&size=280x140&markers=${att.latitude},${att.longitude},red-pushpin`;
    return (
      <a
        href={`https://maps.google.com/?q=${att.latitude},${att.longitude}`}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded border border-black/10"
      >
        <img src={mapSrc} alt="Localização compartilhada" className="block w-full" />
        <div className="flex items-center gap-1.5 bg-black/5 px-2 py-1.5 text-xs">
          <MapPin className="h-3.5 w-3.5 shrink-0" /> Localização compartilhada
        </div>
      </a>
    );
  }
  if (att.kind === "CONTACT") {
    return (
      <div className="flex items-center gap-2 rounded border border-black/10 bg-black/5 px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10">
          <User className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{vcardName(att.vcard, att.fileName)}</p>
          <p className="text-xs opacity-75">Contato</p>
        </div>
      </div>
    );
  }
  // DOCUMENT (and any historical media without a downloaded binary — url is empty in that case)
  if (!att.url) {
    return (
      <div className="flex items-center gap-2 rounded border border-black/10 bg-black/5 px-3 py-2 text-xs opacity-75">
        <FileText className="h-4 w-4 shrink-0" /> Mídia de antes deste sistema acompanhar anexos
      </div>
    );
  }
  return (
    <a href={withAuthToken(att.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded border border-black/10 bg-black/5 px-3 py-2 hover:bg-black/10">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{att.fileName}</p>
        <p className="text-xs opacity-75">{formatBytes(att.sizeBytes)}</p>
      </div>
    </a>
  );
}

export function MessageBubble({
  message,
  onReply,
  onReact,
  onDelete,
  repliedMessage,
  readOnly,
  canDelete,
}: {
  message: MessageDTO;
  onReply: (message: MessageDTO) => void;
  onReact: (message: MessageDTO, emoji: string) => void;
  onDelete?: (message: MessageDTO) => void;
  repliedMessage?: MessageDTO;
  /** Gestão's oversight view: same bubble rendering as Atendimento, but no reply/react — gestores only watch. */
  readOnly?: boolean;
  /** ADMIN-only "excluir mensagem" affordance — local to this app, never touches WhatsApp. */
  canDelete?: boolean;
}) {
  const [showReactions, setShowReactions] = useState(false);
  const [openMedia, setOpenMedia] = useState<LightboxMedia | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isOutbound = message.direction === "OUTBOUND";

  const bubble = (
    <div
      className={clsx(
        "relative max-w-[70%] rounded-card px-3 py-2 text-sm shadow-sm",
        isOutbound ? "bg-primary text-primary-fg" : "bg-surface-alt"
      )}
    >
      {isOutbound && message.senderAgentDisplayName && (
        <>
          <p className="text-xs font-bold opacity-90">{message.senderAgentDisplayName}</p>
          {/* Blank line separating the agent's name from the message itself (never part of the text sent to WhatsApp). */}
          <div className="h-3" aria-hidden="true" />
        </>
      )}

      {repliedMessage && (
        <div className="mb-1.5 rounded border-l-2 border-secondary bg-black/10 px-2 py-1 text-xs opacity-90">
          <p className="font-semibold">{repliedMessage.senderAgentDisplayName ?? "Cliente"}</p>
          <p className="truncate">{repliedMessage.body ?? "Anexo"}</p>
        </div>
      )}

      {message.attachments.map((att) => (
        <div key={att.id} className="mb-1.5">
          <Attachment att={att} onOpenMedia={setOpenMedia} />
        </div>
      ))}

      {message.body && <p className="whitespace-pre-wrap break-words">{renderWhatsAppFormatting(message.body)}</p>}

      <div className={clsx("mt-1 flex items-center gap-1 text-[11px] opacity-75", isOutbound ? "justify-end" : "justify-start")}>
        <span>{format(new Date(message.createdAt), "HH:mm")}</span>
        {isOutbound && <StatusIcon status={message.status} />}
      </div>

      {message.reactions.length > 0 && (
        <div className="absolute -bottom-3 right-2 flex gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs shadow">
          {message.reactions.map((r) => (
            <span key={r.id} title={r.userDisplayName}>
              {r.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // WhatsApp Web puts the hover reply/react icons in the gutter beside the
  // bubble (toward the center of the conversation), not floating above it —
  // real flex siblings here instead of absolute-positioning over the bubble,
  // ordered so they land on the correct side for each direction.
  const actions = (
    <div className="flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
      <button onClick={() => onReply(message)} className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt hover:text-[var(--color-text)]" aria-label="Responder">
        <ReplyIcon className="h-3.5 w-3.5" />
      </button>
      {canDelete && onDelete && (
        <button
          onClick={() => setConfirmDelete(true)}
          className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt hover:text-red-600"
          aria-label="Excluir mensagem"
          title="Excluir mensagem (somente neste sistema)"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setShowReactions((s) => !s)}
          className="focus-ring rounded-full p-1.5 text-muted hover:bg-surface-alt hover:text-[var(--color-text)]"
          aria-label="Reagir"
        >
          <Smile className="h-3.5 w-3.5" />
        </button>
        {showReactions && (
          <div
            className={clsx(
              "absolute top-8 z-10 flex gap-1 rounded-full border border-border bg-surface px-2 py-1 shadow-lg",
              isOutbound ? "right-0" : "left-0"
            )}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(message, emoji);
                  setShowReactions(false);
                }}
                className="focus-ring text-base transition-transform hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className={clsx("group flex items-end gap-1", isOutbound ? "justify-end" : "justify-start")}>
        {readOnly ? (
          bubble
        ) : isOutbound ? (
          <>
            {actions}
            {bubble}
          </>
        ) : (
          <>
            {bubble}
            {actions}
          </>
        )}
      </div>
      {openMedia && <MediaLightbox media={openMedia} onClose={() => setOpenMedia(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Excluir mensagem?</h2>
            <p className="mt-2 text-sm text-muted">
              A mensagem some apenas desta conversa neste sistema. O WhatsApp do cliente e qualquer outro
              aparelho conectado (celular, WhatsApp Web) não são afetados.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDelete?.(message);
                  setConfirmDelete(false);
                }}
                className="focus-ring flex-1 rounded-card bg-red-600 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
