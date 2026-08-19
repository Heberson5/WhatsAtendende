import { useRef, useState } from "react";
import { Mic, Paperclip, Send, X, MapPin } from "lucide-react";
import type { MessageDTO } from "@whatsatendende/types";

const EMOJIS = ["😀", "😂", "😍", "👍", "🙏", "🎉", "😢", "😮", "❤️", "🔥"];

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      await onSendFile(file);
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

      <div className="flex items-center gap-1 px-3 py-2">
        <div className="relative">
          <button
            onClick={() => setShowEmoji((s) => !s)}
            className="focus-ring rounded-full p-2 text-muted hover:bg-surface-alt"
            aria-label="Inserir emoji"
            type="button"
          >
            🙂
          </button>
          {showEmoji && (
            <div className="absolute bottom-12 left-0 z-10 grid grid-cols-5 gap-1 rounded-card border border-border bg-surface p-2 shadow-lg">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    setText((t) => t + emoji);
                    setShowEmoji(false);
                  }}
                  className="text-lg hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
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

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
          placeholder="Digite uma mensagem"
          className="focus-ring mx-1 flex-1 rounded-full border border-border bg-transparent px-4 py-2 text-sm disabled:opacity-60"
        />

        {text.trim() ? (
          <button
            onClick={handleSend}
            disabled={sending || disabled}
            className="focus-ring rounded-full bg-primary p-2.5 text-primary-fg disabled:opacity-60"
            aria-label="Enviar mensagem"
            type="button"
          >
            <Send className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={startRecording} disabled={disabled} className="focus-ring rounded-full p-2.5 text-muted hover:bg-surface-alt" aria-label="Gravar áudio" type="button">
            <Mic className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
