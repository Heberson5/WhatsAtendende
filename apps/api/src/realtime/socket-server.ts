import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../modules/auth/jwt";
import { env } from "../config/env";
import { setIO, ROOMS } from "./realtime";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.WEB_APP_URL, credentials: true },
  });

  // Every socket must present a valid access token — same JWT used for REST
  // auth. Sockets are placed into rooms based on role, so events are only
  // ever broadcast to clients authorized to see them (mirrors the REST RBAC
  // rules; the frontend cannot widen its own visibility by connecting raw).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("unauthorized"));
    try {
      const payload = verifyAccessToken(token);
      socket.data.auth = { userId: payload.sub, role: payload.role, displayName: payload.displayName };
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const auth = socket.data.auth as { userId: string; role: string };
    socket.join(ROOMS.user(auth.userId));
    if (auth.role === "AGENT") {
      // Looked up fresh on every connect (rather than trusted from the JWT)
      // so reassigning an agent to a different WhatsApp connection takes
      // effect on their next reconnect without requiring a new login.
      const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { whatsappConnectionId: true } });
      if (user?.whatsappConnectionId) socket.join(ROOMS.queue(user.whatsappConnectionId));
    }
    if (auth.role === "MANAGER" || auth.role === "ADMIN") socket.join(ROOMS.oversight());

    socket.on("conversation:join", (conversationId: string) => {
      socket.join(ROOMS.conversation(conversationId));
    });
    socket.on("conversation:leave", (conversationId: string) => {
      socket.leave(ROOMS.conversation(conversationId));
    });

    logger.debug({ userId: auth.userId }, "socket connected");
  });

  setIO(io);
  return io;
}
