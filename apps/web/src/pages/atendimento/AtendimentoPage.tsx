import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, Users2 } from "lucide-react";
import type { ConversationListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { ConversationCard } from "../../components/atendimento/ConversationCard";
import { ChatPanel } from "../../components/atendimento/ChatPanel";
import { useSocketEvents } from "../../hooks/useSocketEvents";

export default function AtendimentoPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "mine">("mine");
  const queryClient = useQueryClient();

  useSocketEvents(selectedId);

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: async () => (await api.get<ConversationListItemDTO[]>("/conversations/queue")).data,
    refetchInterval: 20_000,
  });

  const mineQuery = useQuery({
    queryKey: ["mine"],
    queryFn: async () => (await api.get<ConversationListItemDTO[]>("/conversations/mine")).data,
    refetchInterval: 20_000,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/conversations/${id}/accept`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      setSelectedId(id);
      setTab("mine");
      toast.success("Conversa aceita. Ela agora é sua com exclusividade.");
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, "Esta conversa já foi assumida por outro atendente."));
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const selectedConversation = mineQuery.data?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid h-full grid-cols-[340px_1fr] overflow-hidden">
      <div className="flex flex-col overflow-hidden border-r border-border bg-surface">
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("mine")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium ${tab === "mine" ? "border-b-2 border-primary text-primary" : "text-muted"}`}
          >
            <Users2 className="h-4 w-4" /> Meus atendimentos ({mineQuery.data?.length ?? 0})
          </button>
          <button
            onClick={() => setTab("queue")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium ${tab === "queue" ? "border-b-2 border-primary text-primary" : "text-muted"}`}
          >
            <Inbox className="h-4 w-4" /> Fila ({queueQuery.data?.length ?? 0})
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {tab === "mine" &&
            (mineQuery.data?.length ? (
              mineQuery.data.map((c) => (
                <ConversationCard key={c.id} conversation={c} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
              ))
            ) : (
              <EmptyState message="Nenhum atendimento em andamento." />
            ))}

          {tab === "queue" &&
            (queueQuery.data?.length ? (
              queueQuery.data.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  onAccept={() => acceptMutation.mutate(c.id)}
                  accepting={acceptMutation.isPending && acceptMutation.variables === c.id}
                />
              ))
            ) : (
              <EmptyState message="Nenhuma conversa aguardando." />
            ))}
        </div>
      </div>

      <div className="overflow-hidden bg-[var(--color-bg)]">
        {selectedConversation ? (
          <ChatPanel conversation={selectedConversation} onClosed={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Selecione um atendimento para visualizar a conversa
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-2 py-8 text-center text-sm text-muted">{message}</p>;
}
