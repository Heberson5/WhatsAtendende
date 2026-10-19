import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, LogOut, Shield, UserPlus, X } from "lucide-react";
import type { ChatRoomDTO, ChatUserDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { PersonAvatar } from "./ChatAvatar";

/** Members of a group: who's online, owner/admins, adding people (with or without the history) and leaving. */
export function GroupSettings({ room, onClose, onLeft }: { room: ChatRoomDTO; onClose: () => void; onLeft: () => void }) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const [adding, setAdding] = useState<string[]>([]);
  const [canSeeHistory, setCanSeeHistory] = useState(false);
  const { data: users } = useQuery({
    queryKey: ["internal-chat", "users"],
    queryFn: async () => (await api.get<ChatUserDTO[]>("/internal-chat/users")).data,
    enabled: room.canManageMembers,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["internal-chat"] });
  const onError = (err: unknown) => toast.error(getApiErrorMessage(err));

  const addMutation = useMutation({
    mutationFn: () => api.post(`/internal-chat/rooms/${room.id}/members`, { userIds: adding, canSeeHistory }),
    onSuccess: () => {
      setAdding([]);
      refresh();
    },
    onError,
  });
  const adminMutation = useMutation({
    mutationFn: ({ memberId, admin }: { memberId: string; admin: boolean }) => api.put(`/internal-chat/rooms/${room.id}/members/${memberId}/admin`, { admin }),
    onSuccess: refresh,
    onError,
  });
  const leaveMutation = useMutation({
    mutationFn: () => api.post(`/internal-chat/rooms/${room.id}/leave`),
    onSuccess: () => {
      refresh();
      onLeft();
    },
    onError,
  });

  const memberIds = new Set(room.members.map((m) => m.userId));
  const candidates = (users ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{room.name}</h3>
        <button onClick={onClose} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{room.members.length} membros</p>
          <ul className="space-y-1.5">
            {room.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2">
                <PersonAvatar name={m.name} photoUrl={m.photoUrl} presence={m.presence} size="sm" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.isOwner && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-warning">
                    <Crown className="h-3 w-3" /> dono
                  </span>
                )}
                {!m.isOwner && m.isAdmin && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary">
                    <Shield className="h-3 w-3" /> admin
                  </span>
                )}
                {room.canManageAdmins && !m.isOwner && m.userId !== userId && (
                  <button onClick={() => adminMutation.mutate({ memberId: m.userId, admin: !m.isAdmin })} className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-alt">
                    {m.isAdmin ? "Tirar admin" : "Tornar admin"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
        {room.canManageMembers && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Adicionar pessoas</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {candidates.map((u) => {
                const on = adding.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setAdding(on ? adding.filter((x) => x !== u.id) : [...adding, u.id])}
                    className={on ? "rounded-full border border-primary bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary" : "rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-surface-alt"}
                  >
                    {u.name}
                  </button>
                );
              })}
              {candidates.length === 0 && <p className="text-xs text-muted">Todo mundo já está no grupo.</p>}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={canSeeHistory} onChange={(e) => setCanSeeHistory(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
              Pode ver o histórico de mensagens anteriores
            </label>
            <button
              onClick={() => addMutation.mutate()}
              disabled={adding.length === 0 || addMutation.isPending}
              className="focus-ring inline-flex items-center gap-1 rounded-card bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
            >
              <UserPlus className="h-3.5 w-3.5" /> Adicionar
            </button>
          </div>
        )}
      </div>
      {room.canLeave && (
        <div className="border-t border-border p-4">
          <button
            onClick={() => window.confirm(`Sair de "${room.name}"? A conversa some para você.`) && leaveMutation.mutate()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-card px-3 py-1.5 text-sm text-danger hover:bg-danger-soft"
          >
            <LogOut className="h-4 w-4" /> Sair do grupo
          </button>
        </div>
      )}
    </div>
  );
}
