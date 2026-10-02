import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { KeyRound, LogOut, Pencil, Plus, Search, Trash2, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { PERMISSION, type UserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { UserFormModal, type UserFormValues } from "./UserFormModal";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador", MANAGER: "Gestor", AGENT: "Atendente" };
const PRESENCE_LABEL: Record<string, string> = { ONLINE: "Online", AWAY: "Ausente", OFFLINE: "Offline" };

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.permissions);
  const canAdicionar = permissions?.[PERMISSION.USUARIOS_ADICIONAR];
  const canEditar = permissions?.[PERMISSION.USUARIOS_EDITAR];
  const canInativar = permissions?.[PERMISSION.USUARIOS_INATIVAR];
  const [modalUser, setModalUser] = useState<UserDTO | null | "new">(null);
  const [deletingUser, setDeletingUser] = useState<UserDTO | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "paused" | "inactive">("all");

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserDTO[]>("/users")).data,
    // Presença (online/offline) only ever changes via login/logout/force
    // logout elsewhere — a light poll is enough to keep it current here
    // without needing a dedicated realtime channel for this one column.
    refetchInterval: 20_000,
  });

  const createMutation = useMutation({
    mutationFn: (values: UserFormValues) => api.post<UserDTO>("/users", values),
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

  async function handleSubmit(values: UserFormValues): Promise<string> {
    try {
      if (modalUser && modalUser !== "new") {
        await updateMutation.mutateAsync({ id: modalUser.id, values });
        return modalUser.id;
      }
      return (await createMutation.mutateAsync(values)).data.id;
    } catch (err) {
      throw new Error(getApiErrorMessage(err));
    }
  }

  const all = users ?? [];
  const q = search.trim().toLowerCase();
  const filterCounts = {
    all: all.length,
    online: all.filter((u) => u.presence === "ONLINE").length,
    paused: all.filter((u) => u.presence === "AWAY").length,
    inactive: all.filter((u) => u.status !== "ACTIVE").length,
  };
  const visibleUsers = all.filter(
    (u) =>
      (!q || u.fullName.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
      (filter === "all" ||
        (filter === "online" && u.presence === "ONLINE") ||
        (filter === "paused" && u.presence === "AWAY") ||
        (filter === "inactive" && u.status !== "ACTIVE"))
  );

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Gerencie os atendentes, gestores e administradores do sistema.</p>
        {canAdicionar && (
          <button
            onClick={() => setModalUser("new")}
            className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo usuário
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[220px] items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-sm focus-within:border-primary/50">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome ou e-mail"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        {(
          [
            { value: "all", label: "Todos" },
            { value: "online", label: "Online" },
            { value: "paused", label: "Em pausa" },
            { value: "inactive", label: "Inativos" },
          ] as const
        ).map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`focus-ring rounded-full border px-3 py-1 text-xs font-medium ${
              filter === f.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted hover:text-[var(--color-text)]"
            }`}
          >
            {f.label} · {filterCounts[f.value]}
          </button>
        ))}
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
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && visibleUsers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            )}
            {visibleUsers.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {u.photoUrl ? (
                        <img src={u.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">{u.displayName.slice(0, 2).toUpperCase()}</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{u.fullName}</div>
                      <div className="truncate text-xs text-muted">{u.displayName}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-3 text-muted">{u.whatsappConnectionName ?? "-"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.status === "ACTIVE" ? "bg-success-soft text-success" : "border border-border bg-surface-alt text-muted"}`}>
                    {u.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <span
                      className={`h-2 w-2 rounded-full ${u.presence === "ONLINE" ? "bg-green-500" : u.presence === "AWAY" ? "bg-yellow-500" : "bg-gray-300"}`}
                    />
                    {u.presence === "AWAY" && u.pauseReasonName ? `Pausado — ${u.pauseReasonName}` : PRESENCE_LABEL[u.presence]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{u.lastAccessAt ? format(new Date(u.lastAccessAt), "dd/MM/yyyy HH:mm") : "Nunca acessou"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {canEditar && (
                      <button onClick={() => setModalUser(u)} className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt" aria-label="Editar" title="Editar">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canInativar && (
                      <button
                        onClick={() => statusMutation.mutate({ id: u.id, activate: u.status !== "ACTIVE" })}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt"
                        aria-label={u.status === "ACTIVE" ? "Inativar" : "Ativar"}
                        title={u.status === "ACTIVE" ? "Inativar" : "Ativar"}
                      >
                        {u.status === "ACTIVE" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      </button>
                    )}
                    {canEditar && u.presence === "ONLINE" && u.id !== currentUserId && (
                      <button
                        onClick={() => forceLogoutMutation.mutate(u.id)}
                        disabled={forceLogoutMutation.isPending && forceLogoutMutation.variables === u.id}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt disabled:opacity-60"
                        aria-label="Desconectar agora"
                        title="Desconectar agora"
                      >
                        <LogOut className="h-4 w-4" />
                      </button>
                    )}
                    {canEditar && (
                      <button
                        onClick={() => resetPasswordMutation.mutate(u.id)}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt"
                        aria-label="Redefinir senha"
                        title="Redefinir senha"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                    )}
                    {currentUserRole === "ADMIN" && u.id !== currentUserId && (
                      <button
                        onClick={() => setDeletingUser(u)}
                        className="focus-ring rounded-card p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
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
