import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ClosingMessageDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { EncerramentoFormModal, type EncerramentoFormValues } from "./EncerramentoFormModal";

/** Cadastro de mensagens de encerramento automático — ver PROMPT: "Encerramento, o cadastro deverá ser similar com a resposta rápida, mas com alguns diferenciais." */
export function EncerramentoTab() {
  const queryClient = useQueryClient();
  const [modalTarget, setModalTarget] = useState<ClosingMessageDTO | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<ClosingMessageDTO | null>(null);

  const { data: closingMessages, isLoading } = useQuery({
    queryKey: ["closing-messages"],
    queryFn: async () => (await api.get<ClosingMessageDTO[]>("/closing-messages")).data,
  });

  const createMutation = useMutation({
    mutationFn: (values: EncerramentoFormValues) => api.post("/closing-messages", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["closing-messages"] });
      toast.success("Encerramento criado.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EncerramentoFormValues }) => api.patch(`/closing-messages/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["closing-messages"] });
      toast.success("Encerramento atualizado.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/closing-messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["closing-messages"] });
      toast.success("Encerramento excluído.");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  async function handleSubmit(values: EncerramentoFormValues) {
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
        <p className="text-sm text-muted">
          Mensagem enviada automaticamente ao cliente quando um dos usuários selecionados clica em Encerrar. Um usuário só pode estar em um encerramento por vez.
        </p>
        <button
          onClick={() => setModalTarget("new")}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Novo encerramento
        </button>
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Texto</th>
              <th className="px-4 py-3">Usuários</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && closingMessages?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhum encerramento cadastrado ainda.
                </td>
              </tr>
            )}
            {closingMessages?.map((cm) => (
              <tr key={cm.id} className="border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3 font-medium">{cm.name}</td>
                <td className="max-w-xs truncate px-4 py-3 text-muted" title={cm.text}>
                  {cm.text}
                </td>
                <td className="px-4 py-3 text-muted">
                  {cm.assignedUsers.length === 0 ? "-" : cm.assignedUsers.map((u) => u.displayName).join(", ")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${cm.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
                  >
                    {cm.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModalTarget(cm)} className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt" aria-label="Editar" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(cm)}
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
        <EncerramentoFormModal
          closingMessage={modalTarget === "new" ? null : modalTarget}
          allClosingMessages={closingMessages ?? []}
          onClose={() => setModalTarget(null)}
          onSubmit={handleSubmit}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Excluir encerramento?</h2>
            <p className="mt-2 text-sm text-muted">"{deleteTarget.name}" será removido permanentemente. Os usuários vinculados ficam sem encerramento automático.</p>
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
