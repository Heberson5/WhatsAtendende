import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import type { Role } from "@prisma/client";

const conversationInclude = {
  contact: true,
  assignedAgent: true,
  transfers: { orderBy: { createdAt: "desc" as const }, take: 1, include: { fromAgent: true, toAgent: true } },
};

/**
 * Unread badge count per conversation: inbound messages newer than the
 * assigned agent's last "read" marker (or all inbound messages if they
 * have never opened it). One query for the whole list instead of N+1 —
 * the JOIN compares each message against its own conversation's cutoff.
 */
async function getUnreadCounts(conversationIds: string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ conversationId: string; count: bigint }[]>(
    Prisma.sql`
      SELECT m."conversationId" AS "conversationId", COUNT(*)::bigint AS count
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m."conversationId" IN (${Prisma.join(conversationIds)})
        AND m.direction = 'INBOUND'
        AND (c."assignedAgentReadAt" IS NULL OR m."createdAt" > c."assignedAgentReadAt")
      GROUP BY m."conversationId"
    `
  );
  return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
}

/** Contact resolution: WhatsApp is the source of truth for phone -> identity. */
export async function findOrCreateContact(phone: string, name: string | null) {
  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) {
    return prisma.contact.update({
      where: { id: existing.id },
      data: {
        lastInteractionAt: new Date(),
        // Only overwrite the saved name if we didn't have one yet — an
        // agent-entered/CRM name should not be clobbered by WhatsApp's
        // pushName on every message.
        name: existing.name ?? name ?? undefined,
      },
    });
  }
  return prisma.contact.create({ data: { phone, name } });
}

/**
 * Finds the conversation a new inbound message belongs to, or opens a new
 * one. Section 28 (reabertura): once a conversation is CLOSED, any further
 * message from that contact starts a brand-new conversation record (its own
 * queue entry, its own metrics) rather than silently reopening the closed
 * one — this keeps reporting/"conversas unicas" counts meaningful and gives
 * the agent an explicit new queue card. Default routing target is the
 * queue (not the last agent), per spec section 28's default.
 */
export async function findOrOpenConversationForInboundMessage(contactId: string) {
  const active = await prisma.conversation.findFirst({
    where: { contactId, status: { in: ["NEW", "WAITING", "IN_PROGRESS", "TRANSFERRED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { conversation: active, isNewConversation: false };

  const conversation = await prisma.conversation.create({
    data: { contactId, status: "NEW", enteredQueueAt: new Date(), lastMessageAt: new Date() },
  });
  await prisma.conversationEvent.create({
    data: { conversationId: conversation.id, type: "CREATED" },
  });
  return { conversation, isNewConversation: true };
}

export async function listQueue() {
  const conversations = await prisma.conversation.findMany({
    where: { status: { in: ["NEW", "WAITING"] } },
    include: conversationInclude,
    orderBy: { enteredQueueAt: "asc" },
  });
  return conversations;
}

export async function listMyConversations(agentId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { assignedAgentId: agentId, status: { in: ["IN_PROGRESS", "TRANSFERRED"] } },
    include: conversationInclude,
    orderBy: { lastMessageAt: "desc" },
  });
  const unreadCounts = await getUnreadCounts(conversations.map((c) => c.id));
  return conversations.map((c) => Object.assign(c, { _unreadCount: unreadCounts.get(c.id) ?? 0 }));
}

/** Marks a conversation as read by its assigned agent — clears the unread badge. */
export async function markConversationRead(conversationId: string, agentId: string) {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, assignedAgentId: agentId },
    data: { assignedAgentReadAt: new Date() },
  });
  if (result.count === 0) throw Errors.forbidden("Esta conversa nao pertence a este atendente");
}

export interface OversightFilters {
  from?: Date;
  to?: Date;
  agentId?: string;
  status?: string;
  contactSearch?: string;
}

/** Gestão/Admin oversight listing — full visibility, but callers must still enforce read-only in the route layer. */
export async function listAllConversations(filters: OversightFilters) {
  return prisma.conversation.findMany({
    where: {
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      assignedAgentId: filters.agentId,
      status: filters.status ? (filters.status as any) : undefined,
      contact: filters.contactSearch
        ? {
            OR: [
              { name: { contains: filters.contactSearch, mode: "insensitive" } },
              { phone: { contains: filters.contactSearch } },
            ],
          }
        : undefined,
    },
    include: conversationInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getConversationOrThrow(id: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
  if (!conversation) throw Errors.notFound("Conversa nao encontrada");
  return conversation;
}

/**
 * Enforces PROMPT section 10: only the assigned agent may open/respond to a
 * conversation; managers/admins may view (read-only) via the oversight
 * endpoints, never through this check.
 */
export function assertAgentCanAccessConversation(
  conversation: { assignedAgentId: string | null },
  auth: { userId: string; role: Role }
) {
  if (auth.role !== "AGENT") throw Errors.forbidden();
  if (conversation.assignedAgentId !== auth.userId) throw Errors.forbidden("Esta conversa pertence a outro atendente");
}

/**
 * Atomic accept. Two agents clicking ACCEPT at the same time must never
 * both win: the single UPDATE below is executed as one statement with a
 * WHERE clause that only matches while the conversation is still
 * unassigned, and Postgres guarantees that statement is atomic at the row
 * level. `updateMany`'s returned count tells us, without a separate
 * read-then-write race window, whether we actually won the assignment.
 */
export async function acceptConversation(conversationId: string, agentId: string) {
  const now = new Date();
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, status: { in: ["NEW", "WAITING"] }, assignedAgentId: null },
    data: { status: "IN_PROGRESS", assignedAgentId: agentId, acceptedAt: now },
  });

  if (result.count === 0) {
    await prisma.conversationEvent.create({
      data: { conversationId, type: "ACCEPT_CONFLICT", payload: { attemptedBy: agentId } },
    });
    throw Errors.conflict("Esta conversa ja foi assumida por outro atendente.");
  }

  await prisma.$transaction([
    prisma.conversationAssignment.create({
      data: { conversationId, toAgentId: agentId, reason: "ACCEPT" },
    }),
    prisma.conversationEvent.create({
      data: { conversationId, type: "ACCEPTED", payload: { agentId } },
    }),
  ]);

  return getConversationOrThrow(conversationId);
}

export async function transferConversation(
  conversationId: string,
  fromAgentId: string,
  toAgentId: string,
  initiatedById: string,
  note: string | undefined
) {
  if (fromAgentId === toAgentId) throw Errors.badRequest("Selecione um atendente diferente para transferir");

  const target = await prisma.user.findUnique({ where: { id: toAgentId } });
  if (!target || target.status !== "ACTIVE" || target.role !== "AGENT") {
    throw Errors.badRequest("Atendente de destino invalido");
  }

  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, assignedAgentId: fromAgentId, status: { in: ["IN_PROGRESS", "TRANSFERRED"] } },
    // The new agent hasn't read anything yet — clearing this makes every
    // message (including history) count toward their unread badge again.
    data: { status: "TRANSFERRED", assignedAgentId: toAgentId, acceptedAt: new Date(), assignedAgentReadAt: null },
  });
  if (result.count === 0) throw Errors.conflict("Nao foi possivel transferir: conversa ja foi alterada");

  await prisma.$transaction([
    prisma.conversationTransfer.create({
      data: { conversationId, fromAgentId, toAgentId, initiatedById, note },
    }),
    prisma.conversationAssignment.create({
      data: { conversationId, fromAgentId, toAgentId, reason: "TRANSFER" },
    }),
    prisma.conversationEvent.create({
      data: { conversationId, type: "TRANSFERRED", payload: { fromAgentId, toAgentId, note } },
    }),
  ]);

  return getConversationOrThrow(conversationId);
}

export async function closeConversation(conversationId: string, agentId: string) {
  const result = await prisma.conversation.updateMany({
    where: { id: conversationId, assignedAgentId: agentId, status: { in: ["IN_PROGRESS", "TRANSFERRED"] } },
    data: { status: "CLOSED", closedAt: new Date(), closedByUserId: agentId },
  });
  if (result.count === 0) throw Errors.conflict("Nao foi possivel encerrar esta conversa");

  await prisma.conversationEvent.create({ data: { conversationId, type: "CLOSED", payload: { agentId } } });
  return getConversationOrThrow(conversationId);
}
