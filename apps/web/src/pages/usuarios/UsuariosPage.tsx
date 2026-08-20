import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { KeyRound, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import type { UserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { UserFormModal, type UserFormValues } from "./UserFormModal";

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador", MANAGER: "Gestor", AGENT: "Atendente" };

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const [modalUser, setModalUser] = useState<UserDTO | null | "new">(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserDTO[]>("/users")).data,
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
    <div className="flex h-full flex-col overflow-hidden p-6">
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
              <th className="px-4 py-3">Último acesso</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-surface-alt">
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
                <td className="px-4 py-3 text-muted">{u.lastAccessAt ? format(new Date(u.lastAccessAt), "dd/MM/yyyy HH:mm") : "Nunca acessou"}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModalUser(u)} className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt" aria-label="Editar" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => statusMutation.mutate({ id: u.id, activate: u.status !== "ACTIVE" })}
                      className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt"
                      aria-label={u.status === "ACTIVE" ? "Inativar" : "Ativar"}
                      title={u.status === "ACTIVE" ? "Inativar" : "Ativar"}
                    >
                      {u.status === "ACTIVE" ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => resetPasswordMutation.mutate(u.id)}
                      className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt"
                      aria-label="Redefinir senha"
                      title="Redefinir senha"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
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
    </div>
  );
}
