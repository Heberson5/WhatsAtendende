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
    const onNewQueueConversation = (payload: { conversationId: string; contactName: string }) => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      toast.info(`Nova conversa na fila: ${payload.contactName}`);
    };
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
    // Distinct from onMessageNew: only fires for inbound customer messages
    // on a conversation the agent already owns, and only toasts if they
    // aren't already looking at that conversation (it's visible live there).
    const onInboundNotification = (payload: { conversationId: string; contactName: string; preview: string }) => {
      if (payload.conversationId === activeConversationId) return;
      toast.message(payload.contactName, { description: payload.preview });
    };
    const onMessageStatus = (payload: { conversationId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["messages", payload.conversationId] });
    };
    // The linked phone marked a chat as read (WhatsApp's own multi-device
    // sync) — refresh so the unread badge here matches what's already read
    // on the phone, without waiting for the 20s poll.
    const onConversationRead = () => queryClient.invalidateQueries({ queryKey: ["mine"] });
    const onOversightUpdated = () => queryClient.invalidateQueries({ queryKey: ["oversight"] });
    const onWhatsappStatus = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] });

    socket.on("queue:updated", onQueueUpdated);
    socket.on("queue:new-conversation", onNewQueueConversation);
    socket.on("conversation:assigned", onAssigned);
    socket.on("conversation:removed", onRemoved);
    socket.on("conversation:transferred-in", onTransferredIn);
    socket.on("message:new", onMessageNew);
    socket.on("message:inbound-notification", onInboundNotification);
    socket.on("message:status", onMessageStatus);
    socket.on("conversation:read", onConversationRead);
    socket.on("oversight:updated", onOversightUpdated);
    socket.on("whatsapp:status", onWhatsappStatus);

    return () => {
      socket.off("queue:updated", onQueueUpdated);
      socket.off("queue:new-conversation", onNewQueueConversation);
      socket.off("conversation:assigned", onAssigned);
      socket.off("conversation:removed", onRemoved);
      socket.off("conversation:transferred-in", onTransferredIn);
      socket.off("message:new", onMessageNew);
      socket.off("message:inbound-notification", onInboundNotification);
      socket.off("message:status", onMessageStatus);
      socket.off("conversation:read", onConversationRead);
      socket.off("oversight:updated", onOversightUpdated);
      socket.off("whatsapp:status", onWhatsappStatus);
    };
  }, [queryClient, activeConversationId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !activeConversationId) return;
    socket.emit("conversation:join", activeConversationId);
    return () => {
      socket.emit("conversation:leave", activeConversationId);
    };
  }, [activeConversationId]);
}
