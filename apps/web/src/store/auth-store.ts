import { create } from "zustand";
import type { PermissionMap, UserDTO } from "@whatsatendende/types";

interface AuthState {
  accessToken: string | null;
  user: UserDTO | null;
  // What the current user's role can do, resolved server-side (Configurações
  // > Permissões) — null only until the first login/refresh response lands.
  permissions: PermissionMap | null;
  hydrated: boolean;
  // permissions is optional so callers that reuse an existing session (e.g.
  // MeuPerfilPage updating a photo) don't have to refetch or clobber it.
  setSession: (accessToken: string, user: UserDTO, permissions?: PermissionMap) => void;
  clearSession: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  permissions: null,
  hydrated: false,
  setSession: (accessToken, user, permissions) =>
    set((state) => ({ accessToken, user, permissions: permissions ?? state.permissions })),
  clearSession: () => set({ accessToken: null, user: null, permissions: null }),
  setHydrated: () => set({ hydrated: true }),
}));
