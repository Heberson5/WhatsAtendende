import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { KeyRound, LockOpen, LogOut, Pencil, Plus, ShieldAlert, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import type { UserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { UserFormModal, type UserFormValues } from "./UserFormModal";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { RowActionsMenu } from "../../components/common/RowActionsMenu";
import { SkeletonRows } from "../../components/common/Skeleton";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador", MANAGER: "Gestor", AGENT: "Atendente" };
const PRESENCE_LABEL: Record<string, string> = { ONLINE: "Online", AWAY: "Ausente", OFFLINE: "Offline" };

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);
  const [modalUser, setModalUser] = useState<UserDTO | null | "new">(null);
  const [deletingUser, setDeletingUser] = useState<UserDTO | null>(null);
  useEscapeKey(() => setDeletingUser(null), Boolean(deletingUser));

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserDTO[]>("/users")).data,
    // Presença (online/offline) only ever changes via login/logout/force
    // logout elsewhere — a light poll is enough to keep it current here
    // without needing a dedicated realtime channel for this one column.
    refetchInterval: 20_000,
  });

  const createMutation = useMutation({
    mutationFn: (values: UserFormValues) => api.post("/users", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuário criado com sucesso.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UserFormValues }) => api.patch(`/users/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuário atualizado.");
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) => api.post(`/users/${id}/${activate ? "activate" : "deactivate"}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
    onSuccess: (res) => {
      toast.success(`Senha temporária gerada: ${res.data.temporaryPassword}`, { duration: 15000 });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const unlockLoginMutation = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/unlock-login`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Login desbloqueado.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/force-logout`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuário desconectado.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Usuário excluído.");
      setDeletingUser(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  async function handleSubmit(values: UserFormValues) {
    try {
      if (modalUser && modalUser !== "new") {
        await updateMutation.mutateAsync({ id: modalUser.id, values });
      } else {
        await createMutation.mutateAsync(values);
      }
    } catch (err) {
      throw new Error(getApiErrorMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Gerencie os atendentes, gestores e administradores do sistema.</p>
        <button
          onClick={() => setModalUser("new")}
          className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Novo usuário
        </button>
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Conexão WhatsApp</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Presença</th>
              <th className="px-4 py-3">Último acesso</th>
              <th className="sticky right-0 bg-surface-alt px-3 py-3 text-right shadow-[-10px_0_12px_-10px_rgba(15,23,42,0.25)]">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows columns={8} />}
            {users?.map((u) => (
              <tr key={u.id} className="group border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.fullName}</div>
                  <div className="text-xs text-muted">{u.displayName}</div>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-3 text-muted">{u.whatsappConnectionName ?? "-"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {u.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <span
                      className={`h-2 w-2 rounded-full ${u.presence === "ONLINE" ? "bg-green-500" : u.presence === "AWAY" ? "bg-yellow-500" : "bg-gray-300"}`}
                    />
                    {PRESENCE_LABEL[u.presence]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{u.lastAccessAt ? format(new Date(u.lastAccessAt), "dd/MM/yyyy HH:mm") : "Nunca acessou"}</td>
                <td className="sticky right-0 bg-surface px-3 py-2.5 shadow-[-10px_0_12px_-10px_rgba(15,23,42,0.25)] group-hover:bg-surface-alt">
                  {/* Fixed to the right edge: the actions never end up cut off by a narrow screen, and each has its name. */}
                  <div className="flex items-center justify-end gap-1.5">
                    {u.loginLockedUntil && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                        title={`Muitas senhas erradas. Bloqueado para locais desconhecidos até ${format(new Date(u.loginLockedUntil), "dd/MM HH:mm")}`}
                      >
                        <ShieldAlert className="h-3 w-3" /> Login bloqueado
                      </span>
                    )}
                    <button onClick={() => setModalUser(u)} className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-surface-alt">
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                    <RowActionsMenu
                      label={`Mais ações para ${u.fullName}`}
                      actions={[
                        {
                          label: u.status === "ACTIVE" ? "Inativar usuário" : "Ativar usuário",
                          icon: u.status === "ACTIVE" ? UserX : UserCheck,
                          onSelect: () => statusMutation.mutate({ id: u.id, activate: u.status !== "ACTIVE" }),
                        },
                        ...(u.presence === "ONLINE" && u.id !== currentUserId
                          ? [
                              {
                                label: "Desconectar agora",
                                icon: LogOut,
                                disabled: forceLogoutMutation.isPending && forceLogoutMutation.variables === u.id,
                                onSelect: () => forceLogoutMutation.mutate(u.id),
                              },
                            ]
                          : []),
                        ...(u.loginLockedUntil ? [{ label: "Desbloquear login", icon: LockOpen, onSelect: () => unlockLoginMutation.mutate(u.id) }] : []),
                        { label: "Redefinir senha", icon: KeyRound, onSelect: () => resetPasswordMutation.mutate(u.id) },
                        ...(currentUserRole === "ADMIN" && u.id !== currentUserId ? [{ label: "Excluir usuário", icon: Trash2, danger: true, onSelect: () => setDeletingUser(u) }] : []),
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalUser && (
        <UserFormModal user={modalUser === "new" ? null : modalUser} onClose={() => setModalUser(null)} onSubmit={handleSubmit} />
      )}

      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="shadow-elevated w-full max-w-sm rounded-card border border-border bg-surface p-6">
            <h2 className="text-base font-semibold">Excluir usuário</h2>
            <p className="mt-2 text-sm text-muted">
              Tem certeza que deseja excluir <span className="font-medium">{deletingUser.fullName}</span>? Essa ação não pode
              ser desfeita. Se este usuário já tiver atendimentos ou mensagens registrados, use "Inativar" em vez de excluir.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="focus-ring flex-1 rounded-card border border-border py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletingUser.id)}
                disabled={deleteMutation.isPending}
                className="focus-ring flex-1 rounded-card bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
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
