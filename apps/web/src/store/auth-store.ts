import { create } from "zustand";
import type { PermissionMap, UserDTO, WhatsAppConnectionStatus } from "@whatsatendende/types";

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
  // Live-patches the current user's own connection status from the
  // "whatsapp:status" socket event (see useSocketEvents) — powers the
  // AGENT "sua conexão está desconectada" banner in Atendimento without
  // waiting for the next login/refresh. No-op if the event isn't for this
  // user's own connection (AGENT only ever has one; MANAGER/ADMIN have
  // none, so this never matches for them).
  updateOwnConnectionStatus: (connectionId: string, status: WhatsAppConnectionStatus) => void;
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
  updateOwnConnectionStatus: (connectionId, status) =>
    set((state) => {
      if (!state.user || state.user.whatsappConnectionId !== connectionId) return state;
      return { user: { ...state.user, whatsappConnectionStatus: status } };
    }),
}));
