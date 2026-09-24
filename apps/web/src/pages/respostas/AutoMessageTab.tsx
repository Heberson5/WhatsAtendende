import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AutoMessageTemplateDTO, AutoMessageTrigger } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { AutoMessageFormModal, type AutoMessageFormValues } from "./AutoMessageFormModal";

/** Transferência and Aceite are the same list/CRUD shape, just a different trigger — see AutoMessageFormModal. */
export function AutoMessageTab({ trigger, description, emptyMessage }: { trigger: AutoMessageTrigger; description: string; emptyMessage: string }) {
  const queryClient = useQueryClient();
  const [modalTarget, setModalTarget] = useState<AutoMessageTemplateDTO | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<AutoMessageTemplateDTO | null>(null);

  const queryKey = ["auto-message-templates", trigger];
  const { data: templates, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<AutoMessageTemplateDTO[]>("/auto-message-templates", { params: { trigger } })).data,
  });

  const createMutation = useMutation({
    mutationFn: (values: AutoMessageFormValues) => api.post("/auto-message-templates", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Mensagem automática criada.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AutoMessageFormValues }) => api.patch(`/auto-message-templates/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Mensagem automática atualizada.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/auto-message-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Mensagem automática excluída.");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  async function handleSubmit(values: AutoMessageFormValues) {
    try {
      if (modalTarget && modalTarget !== "new") {
        await updateMutation.mutateAsync({ id: modalTarget.id, values });
      } else {
        await createMutation.mutateAsync(values);
      }
    } catch (err) {
      throw new Error(getApiErrorMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{description}</p>
        <button
          onClick={() => setModalTarget("new")}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Nova mensagem
        </button>
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Texto</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && templates?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {templates?.map((t) => (
              <tr key={t.id} className="border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="max-w-sm truncate px-4 py-3 text-muted" title={t.text}>
                  {t.text}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {t.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModalTarget(t)} className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt" aria-label="Editar" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(t)}
                      className="focus-ring rounded-card p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                      aria-label="Excluir"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalTarget && (
        <AutoMessageFormModal
          trigger={trigger}
          template={modalTarget === "new" ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onSubmit={handleSubmit}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Excluir mensagem automática?</h2>
            <p className="mt-2 text-sm text-muted">"{deleteTarget.name}" será removida permanentemente.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="focus-ring flex-1 rounded-card bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
