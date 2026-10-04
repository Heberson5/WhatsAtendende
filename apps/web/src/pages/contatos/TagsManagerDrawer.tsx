import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ManagedTagDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";

const NEW_TAG_COLOR = "#0097B4";

function TagRow({ tag, onChanged }: { tag: ManagedTagDTO; onChanged: () => void }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== tag.name || color.toLowerCase() !== tag.color.toLowerCase();

  const save = useMutation({
    mutationFn: () => api.patch(`/contacts/tags/${tag.id}`, { name: name.trim(), color }),
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
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`Cor da etiqueta ${tag.name}`}
          className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          aria-label="Nome da etiqueta"
          className="focus-ring min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm"
        />
        <span className="w-16 shrink-0 text-end text-xs tabular-nums text-muted">
          {tag.contactCount} {tag.contactCount === 1 ? "contato" : "contatos"}
        </span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="focus-ring shrink-0 rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
          aria-label={`Excluir etiqueta ${tag.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {dirty && !confirming && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setName(tag.name);
              setColor(tag.color);
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

/** Rename, recolor and delete tags — the same tags used in the Atendimento client panel. */
export function TagsManagerDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: tags } = useQuery({
    queryKey: ["managed-tags"],
    queryFn: async () => (await api.get<ManagedTagDTO[]>("/contacts/tags")).data,
  });
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_TAG_COLOR);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["managed-tags"] });
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
  }

  const create = useMutation({
    mutationFn: () => api.post("/contacts/tags", { name: newName.trim(), color: newColor }),
    onSuccess: () => {
      setNewName("");
      refresh();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="tags-manager-title" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="tags-manager-title" className="text-base font-semibold">
            Etiquetas
          </h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
            className="flex items-center gap-2"
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
            <button
              type="submit"
              disabled={!newName.trim() || create.isPending}
              className="focus-ring flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Criar
            </button>
          </form>

          {tags?.length === 0 && <p className="text-center text-sm text-muted">Nenhuma etiqueta ainda.</p>}
          <ul className="divide-y divide-border rounded-card border border-border">
            {tags?.map((t) => (
              <TagRow key={`${t.id}-${t.name}-${t.color}`} tag={t} onChanged={refresh} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
