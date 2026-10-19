import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import type { ConversationListItemDTO, NoReturnSettingsDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { contactDisplayName } from "../../lib/contact-display";

/** How long before the automatic close the agent is warned, with "Manter aberta" / "Encerrar agora". */
const NO_RETURN_WARNING_MS = 60_000;

/** Encerramento por falta de retorno (Respostas › Encerramento) — read by every attendant. */
export function useNoReturnSettings() {
  return useQuery({
    queryKey: ["no-return-settings"],
    queryFn: async () => (await api.get<NoReturnSettingsDTO>("/settings/no-return")).data,
    staleTime: 60_000,
  }).data;
}

export function useNoReturnHold(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hold: boolean) => api.post(`/conversations/${conversationId}/no-return-hold`, { hold }),
    onSuccess: (_res, hold) => {
      toast.success(hold ? "Conversa aguardando o cliente: não será encerrada automaticamente." : "Encerramento automático retomado.");
      queryClient.invalidateQueries({ queryKey: ["mine"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });
}

function minutesLeft(closeAt: string) {
  return Math.max(1, Math.ceil((new Date(closeAt).getTime() - Date.now()) / 60_000));
}

/** Card badge: "⏳ encerra em N min" after the reminder went out, or "Aguardando cliente". */
export function NoReturnBadge({ conversation }: { conversation: ConversationListItemDTO }) {
  if (conversation.noReturnHold) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 text-[10.5px] font-semibold text-muted">
        <PauseCircle className="h-3 w-3" /> Aguardando cliente
      </span>
    );
  }
  if (!conversation.noReturnCloseAt) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-semibold text-warning">
      <Hourglass className="h-3 w-3" /> encerra em {minutesLeft(conversation.noReturnCloseAt)} min
    </span>
  );
}

/** Chat header: the countdown plus "Aguardar cliente" (pauses the automatic close until the customer answers). */
export function NoReturnStatus({
  conversation,
  onHold,
  pending,
  labelClassName,
}: {
  conversation: ConversationListItemDTO;
  onHold: (hold: boolean) => void;
  pending: boolean;
  /** The header's own rule for when button labels fit (icon-only while the client panel is open). */
  labelClassName: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onHold(!conversation.noReturnHold)}
      disabled={pending}
      title={
        conversation.noReturnHold
          ? "Retomar o encerramento automático por falta de retorno"
          : "Aguardar cliente: não encerrar automaticamente por falta de retorno até o cliente responder"
      }
      className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-2 py-1.5 text-xs font-medium hover:bg-surface-alt disabled:opacity-60 sm:px-3"
    >
      {conversation.noReturnHold ? <PauseCircle className="h-3.5 w-3.5 text-primary" /> : <Hourglass className="h-3.5 w-3.5" />}
      <span className={labelClassName}>
        {conversation.noReturnHold ? "Aguardando cliente" : conversation.noReturnCloseAt ? `Encerra em ${minutesLeft(conversation.noReturnCloseAt)} min` : "Aguardar cliente"}
      </span>
    </button>
  );
}

/**
 * One minute before an automatic close, warns the agent with "Manter aberta" (= Aguardar cliente) and "Encerrar
 * agora" — once per countdown.
 */
export function useNoReturnWarnings(conversations: ConversationListItemDTO[] | undefined) {
  const queryClient = useQueryClient();
  const warned = useRef(new Set<string>());

  useEffect(() => {
    const timers: number[] = [];
    for (const c of conversations ?? []) {
      if (!c.noReturnCloseAt || c.noReturnHold) continue;
      const key = `${c.id}|${c.noReturnCloseAt}`;
      if (warned.current.has(key)) continue;
      const closeAt = new Date(c.noReturnCloseAt).getTime();
      const delay = Math.max(0, closeAt - NO_RETURN_WARNING_MS - Date.now());
      if (closeAt <= Date.now()) continue;
      timers.push(
        window.setTimeout(() => {
          warned.current.add(key);
          const name = contactDisplayName(c.contact, c.channel);
          const refresh = () => queryClient.invalidateQueries({ queryKey: ["mine"] });
          toast.warning(`${name} será encerrada em 1 minuto por falta de retorno.`, {
            duration: NO_RETURN_WARNING_MS,
            action: {
              label: "Manter aberta",
              onClick: () =>
                api
                  .post(`/conversations/${c.id}/no-return-hold`, { hold: true })
                  .then(refresh)
                  .catch((err) => toast.error(getApiErrorMessage(err))),
            },
            cancel: {
              label: "Encerrar agora",
              onClick: () =>
                api
                  .post(`/conversations/${c.id}/close-no-return`)
                  .then(refresh)
                  .catch((err) => toast.error(getApiErrorMessage(err))),
            },
          });
        }, delay)
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [conversations, queryClient]);
}
