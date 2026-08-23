import type { Server as SocketIOServer } from "socket.io";

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

function getIO(): SocketIOServer | null {
  return ioInstance;
}

export const ROOMS = {
  // Agents only ever see the queue for their own WhatsApp connection — see
  // PROMPT: "cada usuário atenderá somente a uma determinada conexão".
  queue: (connectionId: string) => `queue:${connectionId}`,
  user: (userId: string) => `user:${userId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  oversight: () => "oversight", // managers/admins watching everything, across all connections
};

export const realtimeEvents = {
  conversationAccepted: (conversationId: string, connectionId: string, agentId: string) => {
    getIO()?.to(ROOMS.queue(connectionId)).emit("queue:updated");
    // MANAGER/ADMIN have no fixed connection room — their combined queue view
    // (oversight room) needs the same refresh so an accepted card disappears there too.
    getIO()?.to(ROOMS.oversight()).emit("queue:updated");
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
    getIO()?.to(ROOMS.user(agentId)).emit("conversation:assigned", { conversationId });
  },
  conversationTransferred: (conversationId: string, fromAgentId: string, toAgentId: string) => {
    getIO()?.to(ROOMS.user(fromAgentId)).emit("conversation:removed", { conversationId });
    getIO()?.to(ROOMS.user(toAgentId)).emit("conversation:transferred-in", { conversationId });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
  conversationClosed: (conversationId: string, agentId: string) => {
    getIO()?.to(ROOMS.user(agentId)).emit("conversation:removed", { conversationId });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
  newMessage: (conversationId: string, agentId: string | null) => {
    getIO()?.to(ROOMS.conversation(conversationId)).emit("message:new", { conversationId });
    if (agentId) getIO()?.to(ROOMS.user(agentId)).emit("message:new", { conversationId });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
  /** A brand-new conversation entered a connection's queue — notifies the agents watching that connection, plus MANAGER/ADMIN's combined queue view. */
  newQueueConversation: (connectionId: string, conversationId: string, contactName: string) => {
    getIO()?.to(ROOMS.queue(connectionId)).emit("queue:updated");
    getIO()?.to(ROOMS.queue(connectionId)).emit("queue:new-conversation", { conversationId, contactName });
    getIO()?.to(ROOMS.oversight()).emit("queue:updated");
    getIO()?.to(ROOMS.oversight()).emit("queue:new-conversation", { conversationId, contactName });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
  /** A new inbound message landed in a conversation the agent already owns — used for the toast, separate from the generic refresh-only newMessage. */
  inboundMessageNotification: (conversationId: string, agentId: string, contactName: string, preview: string) => {
    getIO()?.to(ROOMS.user(agentId)).emit("message:inbound-notification", { conversationId, contactName, preview });
  },
  // Also broadcast to the owning agent's own room — unlike the queue/user/
  // oversight rooms (rejoined automatically server-side on every socket
  // "connection" event), the conversation room is only ever joined via an
  // explicit client emit and can be missed after a reconnect; this keeps
  // delivery/read ticks (and reaction updates) live even then, same as newMessage.
  messageStatusChanged: (conversationId: string, agentId?: string | null) => {
    getIO()?.to(ROOMS.conversation(conversationId)).emit("message:status", { conversationId });
    if (agentId) getIO()?.to(ROOMS.user(agentId)).emit("message:status", { conversationId });
  },
  /** The linked phone marked a chat as read (WhatsApp's own multi-device sync) — refreshes the unread badge for whoever owns it. */
  conversationReadFromDevice: (conversationId: string, agentId: string | null) => {
    if (agentId) getIO()?.to(ROOMS.user(agentId)).emit("conversation:read", { conversationId });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
  whatsappStatusChanged: (connectionId: string, status: unknown) => {
    getIO()?.emit("whatsapp:status", { connectionId, status });
  },
  /** A pending transfer expired without the receiving agent logging in — it bounced back to whoever transferred it. */
  transferReverted: (conversationId: string, revertedToAgentId: string, expiredAgentId: string) => {
    getIO()?.to(ROOMS.user(expiredAgentId)).emit("conversation:removed", { conversationId });
    getIO()?.to(ROOMS.user(revertedToAgentId)).emit("conversation:transferred-in", { conversationId });
    getIO()?.to(ROOMS.oversight()).emit("oversight:updated");
  },
};
