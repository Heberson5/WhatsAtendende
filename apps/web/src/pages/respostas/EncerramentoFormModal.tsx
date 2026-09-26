import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle } from "lucide-react";
import type { ClosingMessageDTO } from "@whatsatendende/types";
import { api } from "../../lib/api";
import { AutoMessagePreview } from "./AutoMessagePreview";
import { fillAutoMessageTags, AGENT_EXAMPLE, CLIENT_EXAMPLE_NAME } from "../../lib/auto-message-tags";

// {{atendente}} kept for parity with Transferência/Aceite — see PROMPT:
// "quero que tenha as tags do cadastro do usuário".
const TAGS: { tag: string; label: string }[] = [
  { tag: "{{atendente}}", label: "Nome de exibição do atendente" },
  { tag: "{{atendente_nome}}", label: "Nome completo do atendente" },
  { tag: "{{atendente_cargo}}", label: "Cargo do atendente" },
  { tag: "{{cliente}}", label: "Nome do cliente" },
];

export interface EncerramentoFormValues {
  name: string;
  text: string;
  active: boolean;
  userIds: string[];
}

interface AssignableUser {
  id: string;
  displayName: string;
  presence: "ONLINE" | "AWAY" | "OFFLINE";
  whatsappConnectionName: string | null;
}

const PRESENCE_DOT: Record<string, string> = { ONLINE: "bg-green-500", AWAY: "bg-yellow-500", OFFLINE: "bg-gray-400" };

export function EncerramentoFormModal({
  closingMessage,
  allClosingMessages,
  onClose,
  onSubmit,
}: {
  closingMessage: ClosingMessageDTO | null;
  /** Every other cadastro — used only to warn when checking a user already assigned elsewhere; see PROMPT: "se habilitar o usuário no recente, irá sair do anterior". */
  allClosingMessages: ClosingMessageDTO[];
  onClose: () => void;
  onSubmit: (values: EncerramentoFormValues) => Promise<void>;
}) {
  const { data: users } = useQuery({
    queryKey: ["agents-transfer-targets-all"],
    queryFn: async () => (await api.get<AssignableUser[]>("/agents/transfer-targets", { params: { excludeSelf: false } })).data,
  });

  const [values, setValues] = useState<EncerramentoFormValues>({
    name: closingMessage?.name ?? "",
    text: closingMessage?.text ?? "",
    active: closingMessage?.active ?? true,
    userIds: closingMessage?.assignedUsers.map((u) => u.id) ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);

  function insertTag(tag: string) {
    if (!textareaEl) {
      setValues((v) => ({ ...v, text: v.text + tag }));
      return;
    }
    const start = textareaEl.selectionStart ?? values.text.length;
    const end = textareaEl.selectionEnd ?? values.text.length;
    const next = values.text.slice(0, start) + tag + values.text.slice(end);
    setValues((v) => ({ ...v, text: next }));
    requestAnimationFrame(() => {
      textareaEl.focus();
      textareaEl.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  // Only one agent involved (whoever is closing), so the sender and the
  // {{atendente}} tags always describe the same example person — unlike
  // Transferência, which involves two.
  const previewText = fillAutoMessageTags(values.text || "...", {
    atendente: AGENT_EXAMPLE.displayName,
    atendenteNome: AGENT_EXAMPLE.fullName,
    atendenteCargo: AGENT_EXAMPLE.cargo,
    cliente: CLIENT_EXAMPLE_NAME,
  });

  // Which OTHER cadastro (not this one) each user currently belongs to —
  // so checking them here can show exactly what they'll be moved out of,
  // instead of silently reassigning.
  const currentlyAssignedElsewhere = new Map<string, string>();
  for (const cm of allClosingMessages) {
    if (cm.id === closingMessage?.id) continue;
    for (const u of cm.assignedUsers) currentlyAssignedElsewhere.set(u.id, cm.name);
  }

  function toggleUser(userId: string) {
    setValues((v) => ({
      ...v,
      userIds: v.userIds.includes(userId) ? v.userIds.filter((id) => id !== userId) : [...v.userIds, userId],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar encerramento");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] w-full max-w-md flex-col rounded-card border border-border bg-surface p-5 shadow-elevated">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{closingMessage ? "Editar encerramento" : "Novo encerramento"}</h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <Field label="Nome">
            <input
              required
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="Ex: Encerramento padrão"
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Texto</span>
              <div className="flex flex-wrap justify-end gap-1">
                {TAGS.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => insertTag(t.tag)}
                    title={`Inserir ${t.label}`}
                    className="focus-ring rounded-full bg-secondary/30 px-2 py-0.5 text-[11px] font-medium text-text hover:bg-secondary/50"
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
              value={values.text}
              onChange={(e) => setValues((v) => ({ ...v, text: e.target.value }))}
              placeholder="Mensagem enviada ao cliente ao encerrar a conversa..."
              className="focus-ring w-full resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted">Use *asterisco* pra negrito. A mensagem é enviada em nome de quem clicar em Encerrar.</p>
          </div>

          <AutoMessagePreview senderName={AGENT_EXAMPLE.fullName} text={previewText} />

          <label className="flex items-center justify-between rounded-card border border-border px-3 py-2">
            <span className="text-sm font-medium">Ativo</span>
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium">Usuários</span>
            <p className="mb-1.5 text-xs text-muted">Ao clicar em Encerrar, estes usuários disparam esta mensagem automaticamente.</p>
            <div className="max-h-52 overflow-y-auto rounded-card border border-border">
              {users?.length === 0 && <p className="p-4 text-center text-xs text-muted">Nenhum usuário disponível.</p>}
              {users?.map((u) => {
                const elsewhere = currentlyAssignedElsewhere.get(u.id);
                const checked = values.userIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex w-full items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-alt"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleUser(u.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRESENCE_DOT[u.presence]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {u.displayName}
                        {u.whatsappConnectionName ? <span className="text-xs text-muted"> · {u.whatsappConnectionName}</span> : null}
                      </span>
                      {elsewhere && checked && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
                          <AlertTriangle className="h-3 w-3 shrink-0" /> Vai sair de "{elsewhere}"
                        </span>
                      )}
                      {elsewhere && !checked && <span className="mt-0.5 block text-xs text-muted">Atualmente em "{elsewhere}"</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
