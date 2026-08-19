import type { Server as SocketIOServer } from "socket.io";

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

function getIO(): SocketIOServer | null {
  return ioInstance;
}

export const ROOMS = {
  queue: () => "queue", // all agents watch the shared queue
  user: (userId: string) => `user:${userId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  oversight: () => "oversight", // managers/admins watching everything
};

export const realtimeEvents = {
  queueUpdated: () => getIO()?.to(ROOMS.queue()).emit("queue:updated"),
  conversationAccepted: (conversationId: string, agentId: string) => {
    getIO()?.to(ROOMS.queue()).emit("queue:updated");
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
  messageStatusChanged: (conversationId: string) => {
    getIO()?.to(ROOMS.conversation(conversationId)).emit("message:status", { conversationId });
  },
  whatsappStatusChanged: (status: unknown) => {
    getIO()?.emit("whatsapp:status", status);
  },
};
