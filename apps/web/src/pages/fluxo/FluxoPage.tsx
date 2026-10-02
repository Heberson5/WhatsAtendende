import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Settings2, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { PERMISSION, type FlowListItemDTO } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { api, getApiErrorMessage } from "../../lib/api";
import { FlowFormModal } from "./FlowFormModal";

/** Lista de fluxos — ver PROMPT: "um novo menu chamado Fluxo... função de ativar e desativar o fluxo". */
export default function FluxoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canAdicionar = permissions?.[PERMISSION.FLUXO_ADICIONAR];
  const canEditar = permissions?.[PERMISSION.FLUXO_EDITAR];
  const canExcluir = permissions?.[PERMISSION.FLUXO_EXCLUIR];
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FlowListItemDTO | null>(null);

  const { data: flows, isLoading } = useQuery({
    queryKey: ["flows"],
    queryFn: async () => (await api.get<FlowListItemDTO[]>("/flows")).data,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/flows/${id}`, { active }),
    onSuccess: (_res, { active }) => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success(active ? "Fluxo ativado." : "Fluxo desativado.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/flows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Fluxo excluído.");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Fluxo</h1>
          <p className="text-sm text-muted">Construtor visual de atendimento automático, vinculado às suas conexões WhatsApp Oficial.</p>
        </div>
        {canAdicionar && (
          <button
            onClick={() => setModalOpen(true)}
            className="focus-ring flex shrink-0 items-center gap-1.5 rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo fluxo
          </button>
        )}
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Conexões</th>
              <th className="px-4 py-3">Nós</th>
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
            {!isLoading && flows?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhum fluxo cadastrado ainda.
                </td>
              </tr>
            )}
            {flows?.map((flow) => (
              <tr key={flow.id} className="border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/fluxo/${flow.id}`)}
                    className="focus-ring flex items-center gap-1.5 font-medium text-text hover:text-primary hover:underline"
                  >
                    <Workflow className="h-3.5 w-3.5 shrink-0 text-muted" /> {flow.name}
                  </button>
                  {flow.description && <p className="mt-0.5 truncate text-xs text-muted">{flow.description}</p>}
                </td>
                <td className="px-4 py-3 text-muted">
                  {flow.connectionNames.length > 0 ? flow.connectionNames.join(", ") : <span className="italic">Nenhuma conexão vinculada</span>}
                </td>
                <td className="px-4 py-3 text-muted">{flow.nodeCount}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => canEditar && toggleActiveMutation.mutate({ id: flow.id, active: !flow.active })}
                    disabled={!canEditar || toggleActiveMutation.isPending}
                    role="switch"
                    aria-checked={flow.active}
                    aria-label={flow.active ? "Desativar fluxo" : "Ativar fluxo"}
                    title={flow.active ? "Desativar fluxo" : "Ativar fluxo"}
                    className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${flow.active ? "bg-green-500" : "bg-border"}`}
                  >
                    <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${flow.active ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {canEditar && (
                      <button
                        onClick={() => navigate(`/fluxo/${flow.id}`)}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt"
                        aria-label="Configurar"
                        title="Configurar fluxo"
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                    )}
                    {canExcluir && (
                      <button
                        onClick={() => setDeleteTarget(flow)}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-red-50 hover:text-red-600"
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <FlowFormModal
          onClose={() => setModalOpen(false)}
          onCreated={(id) => {
            setModalOpen(false);
            navigate(`/fluxo/${id}`);
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Excluir fluxo?</h2>
            <p className="mt-2 text-sm text-muted">
              "{deleteTarget.name}" e todos os seus nós serão removidos permanentemente. Esta ação não pode ser desfeita.
            </p>
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
