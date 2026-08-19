import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { UserDTO, Role } from "@whatsatendende/types";

export interface UserFormValues {
  fullName: string;
  displayName: string;
  email: string;
  password?: string;
  confirmPassword?: string;
  role: Role;
}

export function UserFormModal({
  user,
  onClose,
  onSubmit,
}: {
  user: UserDTO | null;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<UserFormValues>({
    fullName: user?.fullName ?? "",
    displayName: user?.displayName ?? "",
    email: user?.email ?? "",
    password: "",
    confirmPassword: "",
    role: user?.role ?? "AGENT",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user && values.password !== values.confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    setLoading(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar usuário");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-card border border-border bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{user ? "Editar usuário" : "Novo usuário"}</h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Nome completo">
            <input required value={values.fullName} onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm" />
          </Field>
          <Field label="Nome de exibição">
            <input required value={values.displayName} onChange={(e) => setValues((v) => ({ ...v, displayName: e.target.value }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm" />
          </Field>
          <Field label="E-mail">
            <input required type="email" value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm" />
          </Field>
          <Field label="Perfil">
            <select value={values.role} onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as Role }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm">
              <option value="AGENT">Atendente</option>
              <option value="MANAGER">Gestor</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </Field>

          {!user && (
            <>
              <Field label="Senha">
                <input required type="password" minLength={8} value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm" />
              </Field>
              <Field label="Confirmar senha">
                <input required type="password" minLength={8} value={values.confirmPassword} onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))} className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm" />
              </Field>
            </>
          )}
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
