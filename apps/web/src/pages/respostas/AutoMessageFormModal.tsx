import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { AutoMessageTemplateDTO, AutoMessageTrigger } from "@whatsatendende/types";

export interface AutoMessageFormValues {
  trigger: AutoMessageTrigger;
  name: string;
  text: string;
  active: boolean;
}

const TAGS: { tag: string; label: string }[] = [
  { tag: "{{atendente}}", label: "Nome do atendente" },
  { tag: "{{cliente}}", label: "Nome do cliente" },
];

/**
 * Shared form for both auto-message tabs (Transferência/Aceite) — same
 * shape either way (nome, texto com tags, ativo), just a different
 * trigger. See PROMPT: "inclua em uma aba do menu Respostas, para poder
 * editar quando necessário e tenha disponível as tags."
 */
export function AutoMessageFormModal({
  trigger,
  template,
  onClose,
  onSubmit,
}: {
  trigger: AutoMessageTrigger;
  template: AutoMessageTemplateDTO | null;
  onClose: () => void;
  onSubmit: (values: AutoMessageFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [text, setText] = useState(template?.text ?? "");
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);

  function insertTag(tag: string) {
    if (!textareaEl) {
      setText((t) => t + tag);
      return;
    }
    const start = textareaEl.selectionStart ?? text.length;
    const end = textareaEl.selectionEnd ?? text.length;
    const next = text.slice(0, start) + tag + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      textareaEl.focus();
      textareaEl.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit({ trigger, name, text, active });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar mensagem automática");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-card border border-border bg-surface p-5 shadow-elevated">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{template ? "Editar mensagem automática" : "Nova mensagem automática"}</h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Nome</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Aviso padrão"
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Texto</span>
              <div className="flex gap-1">
                {TAGS.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => insertTag(t.tag)}
                    title={`Inserir ${t.label}`}
                    className="focus-ring rounded-full bg-secondary/30 px-2 py-0.5 text-[11px] font-medium text-secondary-fg hover:bg-secondary/50"
                  >
                    {t.tag}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={setTextareaEl}
              required
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ex: Esta conversa foi transferida para {{atendente}}."
              className="focus-ring w-full resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              Use as tags acima pra inserir o nome do atendente ou do cliente automaticamente. Enviada como "Sistema" — nunca com o nome de um atendente.
            </p>
          </div>

          <label className="flex items-center justify-between rounded-card border border-border px-3 py-2">
            <span className="text-sm font-medium">Ativo</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-primary" />
          </label>
        </div>

        {error && <p className="mt-3 rounded-card bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60">
            {loading ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
