import clsx from "clsx";
import { format } from "date-fns";
import { Check, CheckCheck, Clock, ReplyIcon, Smile } from "lucide-react";
import type { MessageDTO } from "@whatsatendende/types";
import { useState } from "react";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function StatusIcon({ status }: { status: MessageDTO["status"] }) {
  if (status === "PENDING") return <Clock className="h-3.5 w-3.5" />;
  if (status === "SENT") return <Check className="h-3.5 w-3.5" />;
  if (status === "DELIVERED") return <CheckCheck className="h-3.5 w-3.5" />;
  if (status === "READ") return <CheckCheck className="h-3.5 w-3.5 text-blue-400" />;
  return <span className="text-red-400">!</span>;
}

export function MessageBubble({
  message,
  onReply,
  onReact,
  repliedMessage,
}: {
  message: MessageDTO;
  onReply: (message: MessageDTO) => void;
  onReact: (message: MessageDTO, emoji: string) => void;
  repliedMessage?: MessageDTO;
}) {
  const [showReactions, setShowReactions] = useState(false);
  const isOutbound = message.direction === "OUTBOUND";

  return (
    <div className={clsx("group flex", isOutbound ? "justify-end" : "justify-start")}>
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
            {att.kind === "IMAGE" && <img src={att.url} alt={att.fileName} className="max-h-64 rounded" />}
            {att.kind === "VIDEO" && <video src={att.url} controls className="max-h-64 rounded" />}
            {att.kind === "AUDIO" && <audio src={att.url} controls className="w-full" />}
            {att.kind === "LOCATION" && att.latitude && att.longitude && (
              <a
                href={`https://maps.google.com/?q=${att.latitude},${att.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                📍 Localização compartilhada
              </a>
            )}
            {att.kind === "CONTACT" && <p>👤 Contato: {att.fileName}</p>}
            {["DOCUMENT"].includes(att.kind) && (
              <a href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
                📄 {att.fileName}
              </a>
            )}
          </div>
        ))}

        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

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

        <div
          className={clsx(
            "absolute top-0 hidden -translate-y-full items-center gap-1 rounded-full border border-border bg-surface px-1 py-0.5 shadow group-hover:flex",
            isOutbound ? "right-0" : "left-0"
          )}
        >
          <button onClick={() => onReply(message)} className="focus-ring rounded-full p-1 text-muted hover:text-[var(--color-text)]" aria-label="Responder">
            <ReplyIcon className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowReactions((s) => !s)}
              className="focus-ring rounded-full p-1 text-muted hover:text-[var(--color-text)]"
              aria-label="Reagir"
            >
              <Smile className="h-3.5 w-3.5" />
            </button>
            {showReactions && (
              <div className="absolute top-6 z-10 flex gap-1 rounded-full border border-border bg-surface px-2 py-1 shadow-lg">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onReact(message, emoji);
                      setShowReactions(false);
                    }}
                    className="focus-ring text-base hover:scale-125 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
