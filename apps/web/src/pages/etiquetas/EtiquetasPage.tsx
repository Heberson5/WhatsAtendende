import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailX, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PERMISSION, type ManagedTagDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";

const NEW_TAG_COLOR = "#0097B4";

function SkipSurveyCheckbox({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
      Não enviar pesquisa
    </label>
  );
}

function TagRow({ tag, onChanged, canEdit, canDelete }: { tag: ManagedTagDTO; onChanged: () => void; canEdit: boolean; canDelete: boolean }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [skipSurvey, setSkipSurvey] = useState(tag.skipSurvey);
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== tag.name || color.toLowerCase() !== tag.color.toLowerCase() || skipSurvey !== tag.skipSurvey;

  const save = useMutation({
    mutationFn: () => api.patch(`/contacts/tags/${tag.id}`, { name: name.trim(), color, skipSurvey }),
    onSuccess: () => {
      toast.success("Etiqueta salva.");
      onChanged();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/contacts/tags/${tag.id}`),
    onSuccess: () => {
      toast.success(`Etiqueta "${tag.name}" excluída.`);
      onChanged();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={color}
          disabled={!canEdit}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Cor da etiqueta ${tag.name}`}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
        />
        <input
          value={name}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          aria-label="Nome da etiqueta"
          className="focus-ring min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm"
        />
        <SkipSurveyCheckbox checked={skipSurvey} onChange={setSkipSurvey} disabled={!canEdit} />
        <span className="w-20 shrink-0 text-end text-xs tabular-nums text-muted">
          {tag.contactCount} {tag.contactCount === 1 ? "contato" : "contatos"}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="focus-ring shrink-0 rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
            aria-label={`Excluir etiqueta ${tag.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {dirty && !confirming && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setName(tag.name);
              setColor(tag.color);
              setSkipSurvey(tag.skipSurvey);
            }}
            className="focus-ring rounded-lg border border-border px-2.5 py-1 text-xs"
          >
            Descartar
          </button>
          <button
            type="button"
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="focus-ring rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-fg disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      )}
      {confirming && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-xs text-danger">
          <span className="me-auto">
            Excluir "{tag.name}"? {tag.contactCount > 0 && `Sai de ${tag.contactCount} ${tag.contactCount === 1 ? "contato" : "contatos"}.`}
          </span>
          <button type="button" onClick={() => setConfirming(false)} className="focus-ring rounded-lg border border-danger/30 px-2.5 py-1">
            Cancelar
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="focus-ring rounded-lg bg-danger px-2.5 py-1 font-semibold text-white disabled:opacity-50"
          >
            Excluir
          </button>
        </div>
      )}
    </li>
  );
}

/** Automação › Etiquetas: o único lugar onde as etiquetas são cadastradas; no atendimento elas só são escolhidas na lista. */
export default function EtiquetasPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canAdd = !!permissions?.[PERMISSION.ETIQUETAS_ADICIONAR];
  const canEdit = !!permissions?.[PERMISSION.ETIQUETAS_EDITAR];
  const canDelete = !!permissions?.[PERMISSION.ETIQUETAS_EXCLUIR];
  const queryClient = useQueryClient();
  const { data: tags } = useQuery({
    queryKey: ["managed-tags"],
    queryFn: async () => (await api.get<ManagedTagDTO[]>("/contacts/tags")).data,
  });
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_TAG_COLOR);
  const [newSkipSurvey, setNewSkipSurvey] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["managed-tags"] });
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  }

  const create = useMutation({
    mutationFn: () => api.post("/contacts/tags", { name: newName.trim(), color: newColor, skipSurvey: newSkipSurvey }),
    onSuccess: () => {
      setNewName("");
      setNewSkipSurvey(false);
      refresh();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-6">
      <p className="text-sm text-muted">
        Etiquetas que os atendentes escolhem no painel do cliente durante o atendimento. Marque <strong>Não enviar pesquisa</strong> para contatos
        (como funcionários) que devem receber só a mensagem de encerramento e ficar fora do NPS.
      </p>
      {canAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate();
          }}
          className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3"
        >
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label="Cor da nova etiqueta"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            placeholder="Nova etiqueta"
            className="focus-ring min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          />
          <SkipSurveyCheckbox checked={newSkipSurvey} onChange={setNewSkipSurvey} />
          <button
            type="submit"
            disabled={!newName.trim() || create.isPending}
            className="focus-ring flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Criar
          </button>
        </form>
      )}

      {tags?.length === 0 && <p className="text-center text-sm text-muted">Nenhuma etiqueta ainda.</p>}
      {!!tags?.length && (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {tags.map((t) => (
            <TagRow key={`${t.id}-${t.name}-${t.color}-${t.skipSurvey}`} tag={t} onChanged={refresh} canEdit={canEdit} canDelete={canDelete} />
          ))}
        </ul>
      )}
      {tags?.some((t) => t.skipSurvey) && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <MailX className="h-3.5 w-3.5" /> Contatos com etiqueta marcada não recebem pesquisa e saem do NPS, inclusive das respostas antigas.
        </p>
      )}
    </div>
  );
}
