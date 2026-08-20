import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { parseListParam } from "../../lib/parse-list-param";
import { toConversationListItemDTO } from "./conversations.mapper";
import * as service from "./conversations.service";
import { realtimeEvents } from "../../realtime/realtime";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// Queue: scoped to the requesting agent's own WhatsApp connection — never with a preview (mapper enforces this).
conversationsRouter.get(
  "/queue",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const agent = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { whatsappConnectionId: true } });
    if (!agent?.whatsappConnectionId) return res.json([]); // not assigned to a connection yet — nothing to queue from
    const conversations = await service.listQueue(agent.whatsappConnectionId);
    res.json(conversations.map((c) => toConversationListItemDTO(c, false)));
  })
);

conversationsRouter.get(
  "/mine",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const conversations = await service.listMyConversations(req.auth!.userId);
    res.json(conversations.map((c) => toConversationListItemDTO(c, true)));
  })
);

// Oversight: MANAGER/ADMIN only, read-only by construction (no accept/transfer/close routes are reachable by them).
const oversightQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agentId: z.string().uuid().optional(),
  status: z.enum(["NEW", "WAITING", "IN_PROGRESS", "TRANSFERRED", "CLOSED", "ABANDONED"]).optional(),
  q: z.string().optional(),
  // Repeated query param (?connectionId=a&connectionId=b) or comma-separated; empty/absent = all connections.
  connectionId: z.union([z.string(), z.array(z.string())]).optional(),
});
conversationsRouter.get(
  "/oversight",
  requireRole("MANAGER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const filters = oversightQuerySchema.parse(req.query);
    const connectionIds = parseListParam(filters.connectionId);
    const conversations = await service.listAllConversations({
      from: filters.from,
      to: filters.to,
      agentId: filters.agentId,
      status: filters.status,
      contactSearch: filters.q,
      connectionIds,
    });
    res.json(conversations.map((c) => toConversationListItemDTO(c, true)));
  })
);

conversationsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const conversation = await service.getConversationOrThrow(req.params.id);
    if (req.auth!.role === "AGENT") {
      service.assertAgentCanAccessConversation(conversation, req.auth!);
    }
    // MANAGER/ADMIN fall through: read access granted, but this GET route
    // never permits mutation — reply/transfer/close routes independently
    // re-check assertAgentCanAccessConversation below.
    res.json(toConversationListItemDTO(conversation, true));
  })
);

conversationsRouter.post(
  "/:id/accept",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const conversation = await service.acceptConversation(req.params.id, req.auth!.userId);
    await writeAudit({ userId: req.auth!.userId, action: "CONVERSATION_ACCEPTED", entity: "Conversation", entityId: conversation.id, ipAddress: req.ip ?? null });
    realtimeEvents.conversationAccepted(conversation.id, conversation.whatsappConnectionId, req.auth!.userId);
    res.json(toConversationListItemDTO(conversation, true));
  })
);

const transferSchema = z.object({ toAgentId: z.string().uuid(), note: z.string().max(500).optional() });
conversationsRouter.post(
  "/:id/transfer",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const existing = await service.getConversationOrThrow(req.params.id);
    service.assertAgentCanAccessConversation(existing, req.auth!);
    const { toAgentId, note } = transferSchema.parse(req.body);
    const conversation = await service.transferConversation(req.params.id, req.auth!.userId, toAgentId, req.auth!.userId, note);
    await writeAudit({ userId: req.auth!.userId, action: "CONVERSATION_TRANSFERRED", entity: "Conversation", entityId: conversation.id, ipAddress: req.ip ?? null, metadata: { toAgentId, note, offlineAtTransfer: conversation.pendingTransferDeadline !== null } });
    realtimeEvents.conversationTransferred(conversation.id, req.auth!.userId, toAgentId);
    res.json(toConversationListItemDTO(conversation, true));
  })
);

conversationsRouter.post(
  "/:id/read",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    await service.markConversationRead(req.params.id, req.auth!.userId);
    res.status(204).end();
  })
);

conversationsRouter.post(
  "/:id/close",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const existing = await service.getConversationOrThrow(req.params.id);
    service.assertAgentCanAccessConversation(existing, req.auth!);
    const conversation = await service.closeConversation(req.params.id, req.auth!.userId);
    await writeAudit({ userId: req.auth!.userId, action: "CONVERSATION_CLOSED", entity: "Conversation", entityId: conversation.id, ipAddress: req.ip ?? null });
    realtimeEvents.conversationClosed(conversation.id, req.auth!.userId);
    res.json(toConversationListItemDTO(conversation, true));
  })
);
