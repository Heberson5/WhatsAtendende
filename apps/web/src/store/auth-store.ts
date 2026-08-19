import { create } from "zustand";
import type { UserDTO } from "@whatsatendende/types";

interface AuthState {
  accessToken: string | null;
  user: UserDTO | null;
  hydrated: boolean;
  setSession: (accessToken: string, user: UserDTO) => void;
  clearSession: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  hydrated: false,
  setSession: (accessToken, user) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
  setHydrated: () => set({ hydrated: true }),
}));
