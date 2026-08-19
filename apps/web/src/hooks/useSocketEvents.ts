import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSocket } from "../lib/socket";

/** Subscribes to server-pushed realtime events and invalidates the affected React Query caches — no polling. */
export function useSocketEvents(activeConversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onQueueUpdated = () => queryClient.invalidateQueries({ queryKey: ["queue"] });
    const onAssigned = () => {
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      toast.success("Nova conversa aceita.");
    };
    const onRemoved = () => queryClient.invalidateQueries({ queryKey: ["mine"] });
    const onTransferredIn = () => {
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      toast.info("Uma conversa foi transferida para você.");
    };
    const onMessageNew = (payload: { conversationId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      queryClient.invalidateQueries({ queryKey: ["messages", payload.conversationId] });
    };
    const onMessageStatus = (payload: { conversationId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["messages", payload.conversationId] });
    };
    const onOversightUpdated = () => queryClient.invalidateQueries({ queryKey: ["oversight"] });
    const onWhatsappStatus = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] });

    socket.on("queue:updated", onQueueUpdated);
    socket.on("conversation:assigned", onAssigned);
    socket.on("conversation:removed", onRemoved);
    socket.on("conversation:transferred-in", onTransferredIn);
    socket.on("message:new", onMessageNew);
    socket.on("message:status", onMessageStatus);
    socket.on("oversight:updated", onOversightUpdated);
    socket.on("whatsapp:status", onWhatsappStatus);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("conversation:assigned", onAssigned);
      socket.off("conversation:removed", onRemoved);
      socket.off("conversation:transferred-in", onTransferredIn);
      socket.off("message:new", onMessageNew);
      socket.off("message:status", onMessageStatus);
      socket.off("oversight:updated", onOversightUpdated);
      socket.off("whatsapp:status", onWhatsappStatus);
    };
  }, [queryClient]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !activeConversationId) return;
    socket.emit("conversation:join", activeConversationId);
    return () => {
      socket.emit("conversation:leave", activeConversationId);
    };
  }, [activeConversationId]);
}
