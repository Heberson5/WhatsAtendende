import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Sun, Monitor, UserCircle, Menu, PauseCircle, PlayCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { PauseReasonDTO, UserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { useTheme } from "../../hooks/useTheme";
import { disconnectSocket } from "../../lib/socket";
import { InstallAppButton } from "./InstallAppButton";
import { NotificationBell } from "./NotificationBell";

const PRESENCE_LABEL: Record<string, string> = { ONLINE: "Online", AWAY: "Ausente", OFFLINE: "Offline" };

export function Topbar({ title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const updateOwnPauseState = useAuthStore((s) => s.updateOwnPauseState);
  const navigate = useNavigate();
  const { preference, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pausePickerOpen, setPausePickerOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: pauseReasons } = useQuery({
    queryKey: ["pause-reasons-active"],
    queryFn: async () => (await api.get<PauseReasonDTO[]>("/pause-reasons/active")).data,
    enabled: pausePickerOpen,
  });

  const pauseMutation = useMutation({
    mutationFn: (pauseReasonId: string) => api.post<UserDTO>("/profile/pause", { pauseReasonId }),
    onSuccess: (res) => {
      updateOwnPauseState(res.data.pauseReasonId, res.data.pauseReasonName);
      setPausePickerOpen(false);
      setMenuOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post<UserDTO>("/profile/resume"),
    onSuccess: (res) => {
      updateOwnPauseState(res.data.pauseReasonId, res.data.pauseReasonName);
      setMenuOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => undefined);
    disconnectSocket();
    clearSession();
    navigate("/login");
  }

  return (
    <header className="shadow-soft relative z-10 flex h-16 items-center justify-between gap-2 border-b border-border bg-surface px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          className="focus-ring shrink-0 rounded-card p-1.5 text-muted hover:bg-surface-alt md:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-lg font-semibold">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <NotificationBell />
        <InstallAppButton />
        <div className="flex items-center gap-0.5 rounded-full border border-border p-1 sm:gap-1">
          <button
            className={`focus-ring rounded-full p-1.5 ${preference === "LIGHT" ? "bg-secondary text-secondary-fg" : "text-muted"}`}
            onClick={() => setTheme("LIGHT")}
            aria-label="Tema claro"
          >
            <Sun className="h-4 w-4" />
          </button>
          <button
            className={`focus-ring rounded-full p-1.5 ${preference === "DARK" ? "bg-secondary text-secondary-fg" : "text-muted"}`}
            onClick={() => setTheme("DARK")}
            aria-label="Tema escuro"
          >
            <Moon className="h-4 w-4" />
          </button>
          <button
            className={`focus-ring rounded-full p-1.5 ${preference === "AUTO" ? "bg-secondary text-secondary-fg" : "text-muted"}`}
            onClick={() => setTheme("AUTO")}
            aria-label="Tema automático"
          >
            <Monitor className="h-4 w-4" />
          </button>
        </div>

        <div className="relative">
          <button
            className="focus-ring flex items-center gap-2 rounded-card px-1.5 py-1.5 hover:bg-surface-alt sm:px-2"
            onClick={() => {
              setMenuOpen((o) => !o);
              setPausePickerOpen(false);
            }}
          >
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-fg">
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt={user.displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">{user?.displayName.slice(0, 1).toUpperCase()}</div>
              )}
            </div>
            <div className="hidden text-left text-sm sm:block">
              <div className="font-medium">{user?.displayName}</div>
              <div className="text-xs text-muted">
                {user?.presence === "AWAY" && user.pauseReasonName ? `Pausado — ${user.pauseReasonName}` : user ? PRESENCE_LABEL[user.presence] : ""}
              </div>
            </div>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 z-20 w-56 rounded-card border border-border bg-surface py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/perfil");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-alt"
              >
                <UserCircle className="h-4 w-4" /> Meu Perfil
              </button>

              {user?.presence === "AWAY" ? (
                <button
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-green-600 hover:bg-surface-alt disabled:opacity-60"
                >
                  <PlayCircle className="h-4 w-4" /> {resumeMutation.isPending ? "Retomando..." : "Retomar atendimento"}
                </button>
              ) : pausePickerOpen ? (
                <div className="px-3 py-2">
                  <p className="mb-1.5 text-xs font-medium text-muted">Motivo da pausa</p>
                  {pauseReasons?.length === 0 && <p className="text-xs text-muted">Nenhum motivo cadastrado.</p>}
                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {pauseReasons?.map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => pauseMutation.mutate(reason.id)}
                        disabled={pauseMutation.isPending}
                        className="focus-ring block w-full rounded-card px-2 py-1.5 text-left text-sm hover:bg-surface-alt disabled:opacity-60"
                      >
                        {reason.name}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setPausePickerOpen(false)} className="mt-1 text-xs text-muted hover:underline">
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPausePickerOpen(true)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-alt"
                >
                  <PauseCircle className="h-4 w-4" /> Pausar atendimento
                </button>
              )}

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-surface-alt"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
