import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, X, MapPin, Bold, Italic, Strikethrough } from "lucide-react";
import type { MessageDTO } from "@whatsatendende/types";

// A compact but representative slice of the WhatsApp Web emoji panel —
// grouped so the picker reads as categories, not one undifferentiated wall.
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Sorrisos",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "😘", "😋", "😜", "🤪", "🤔", "🤨"],
  },
  {
    label: "Gestos",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "👋", "🤝", "💪", "✌️", "🤞", "👌", "✋", "🖐️", "🤙", "👆", "👉"],
  },
  {
    label: "Corações",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕", "💖", "💗"],
  },
  {
    label: "Outros",
    emojis: ["🎉", "🔥", "✨", "⭐", "😢", "😭", "😮", "😱", "😴", "🤗", "😎", "🥳", "✅", "❌", "⚠️", "❓"],
  },
];

const MAX_TEXTAREA_LINES = 10;

export function Composer({
  onSendText,
  onSendFile,
  onSendLocation,
  replyTo,
  onCancelReply,
  disabled,
}: {
  onSendText: (text: string, replyToMessageId?: string) => Promise<void>;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  onSendLocation: (lat: number, lng: number) => Promise<void>;
  replyTo: MessageDTO | null;
  onCancelReply: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Closes the emoji panel on any click outside it — it was staying open and
  // getting in the way until the user clicked the toggle button again.
  useEffect(() => {
    if (!showEmoji) return;
    function handleClickOutside(e: MouseEvent) {
      if (emojiPanelRef.current && !emojiPanelRef.current.contains(e.target as Node)) setShowEmoji(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmoji]);

  // Grows the textarea with its content, capped at MAX_TEXTAREA_LINES so a
  // very long message doesn't push the rest of the chat off screen.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20");
    const maxHeight = lineHeight * MAX_TEXTAREA_LINES;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [text]);

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onSendText(text.trim(), replyTo?.id);
      setText("");
      onCancelReply();
    } finally {
      setSending(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setCaption("");
    }
    e.target.value = "";
  }

  async function confirmSendFile() {
    if (!pendingFile) return;
    setSending(true);
    try {
      await onSendFile(pendingFile, caption.trim() || undefined);
      setPendingFile(null);
      setCaption("");
    } finally {
      setSending(false);
    }
  }

  function handleShareLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onSendLocation(pos.coords.latitude, pos.coords.longitude),
      () => alert("Nao foi possivel obter sua localizacao")
    );
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      alert("Permissao de microfone negada ou indisponivel");
    }
  }

  function cancelRecording() {
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  function stopAndSendRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const file = new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
      setSending(true);
      try {
        await onSendFile(file);
      } finally {
        setSending(false);
      }
    };
    recorder.stream.getTracks().forEach((t) => t.stop());
    recorder.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  // WhatsApp Web's own formatting shortcuts: wrap the current selection (or
  // insert empty markers at the caret) with the matching marker characters.
  function wrapSelection(marker: string) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    const next = `${value.slice(0, selectionStart)}${marker}${selected}${marker}${value.slice(selectionEnd)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = selected ? selectionEnd + marker.length * 2 : selectionStart + marker.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrapSelection("*");
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrapSelection("_");
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
      e.preventDefault();
      wrapSelection("~");
    }
  }

  if (recording) {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-surface px-4 py-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm font-medium">
          Gravando... {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:{String(recordSeconds % 60).padStart(2, "0")}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={cancelRecording} className="focus-ring rounded-full p-2 text-muted hover:bg-surface-alt" aria-label="Cancelar gravação">
            <X className="h-5 w-5" />
          </button>
          <button onClick={stopAndSendRecording} className="focus-ring rounded-full bg-primary p-2 text-primary-fg" aria-label="Enviar áudio">
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  if (pendingFile) {
    const isImage = pendingFile.type.startsWith("image/");
    const isVideo = pendingFile.type.startsWith("video/");
    const previewUrl = isImage || isVideo ? URL.createObjectURL(pendingFile) : null;
    return (
      <div className="border-t border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-surface-alt p-3">
          {isImage && previewUrl ? (
            <img src={previewUrl} alt={pendingFile.name} className="h-16 w-16 rounded object-cover" />
          ) : isVideo && previewUrl ? (
            <video src={previewUrl} className="h-16 w-16 rounded object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded bg-surface text-xs text-muted">Arquivo</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{pendingFile.name}</p>
            <p className="text-xs text-muted">{(pendingFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <button onClick={() => setPendingFile(null)} className="focus-ring shrink-0 rounded-full p-1.5 text-muted hover:bg-surface" aria-label="Cancelar envio">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmSendFile()}
            placeholder="Adicionar legenda (opcional)"
            autoFocus
            className="focus-ring flex-1 rounded-full border border-border bg-transparent px-4 py-2 text-sm"
          />
          <button
            onClick={confirmSendFile}
            disabled={sending}
            className="focus-ring flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> Enviar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-surface">
      {replyTo && (
        <div className="flex items-center justify-between border-b border-border bg-surface-alt px-4 py-2 text-xs">
          <div className="min-w-0">
            <p className="font-semibold">{replyTo.senderAgentDisplayName ?? "Cliente"}</p>
            <p className="truncate text-muted">{replyTo.body ?? "Anexo"}</p>
          </div>
          <button onClick={onCancelReply} className="focus-ring shrink-0 rounded-full p-1 text-muted hover:bg-surface" aria-label="Cancelar resposta">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1 px-3 py-2">
        <div className="relative" ref={emojiPanelRef}>
          <button
            onClick={() => setShowEmoji((s) => !s)}
            className="focus-ring rounded-full p-2 text-muted hover:bg-surface-alt"
            aria-label="Inserir emoji"
            type="button"
          >
            🙂
          </button>
          {showEmoji && (
            <div className="shadow-elevated absolute bottom-12 left-0 z-10 w-72 rounded-card border border-border bg-surface p-2">
              <div className="mb-1 flex items-center gap-2 border-b border-border px-1 pb-2 text-muted">
                <Bold className="h-3.5 w-3.5" />
                <Italic className="h-3.5 w-3.5" />
                <Strikethrough className="h-3.5 w-3.5" />
                <span className="ml-auto text-[10px]">Ctrl+B / Ctrl+I / Ctrl+Shift+X para formatar o texto</span>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {EMOJI_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{group.label}</p>
                    <div className="grid grid-cols-8 gap-0.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setText((t) => t + emoji);
                            textareaRef.current?.focus();
                          }}
                          className="focus-ring rounded p-1 text-lg transition-transform hover:scale-125 hover:bg-surface-alt"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => fileInputRef.current?.click()} className="focus-ring rounded-full p-2 text-muted hover:bg-surface-alt" aria-label="Anexar arquivo" type="button">
          <Paperclip className="h-5 w-5" />
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />

        <button onClick={handleShareLocation} className="focus-ring rounded-full p-2 text-muted hover:bg-surface-alt" aria-label="Enviar localização" type="button">
          <MapPin className="h-5 w-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="Digite uma mensagem"
          className="focus-ring mx-1 flex-1 resize-none rounded-2xl border border-border bg-transparent px-4 py-2 text-sm leading-5 disabled:opacity-60"
        />

        {text.trim() ? (
          <button
            onClick={handleSend}
            disabled={sending || disabled}
            className="focus-ring shrink-0 rounded-full bg-primary p-2.5 text-primary-fg disabled:opacity-60"
            aria-label="Enviar mensagem"
            type="button"
          >
            <Send className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={startRecording} disabled={disabled} className="focus-ring shrink-0 rounded-full p-2.5 text-muted hover:bg-surface-alt" aria-label="Gravar áudio" type="button">
            <Mic className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
