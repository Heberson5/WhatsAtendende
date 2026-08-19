import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import type { MessageType } from "@prisma/client";

const messageInclude = {
  senderAgent: true,
  attachments: true,
  reactions: { include: { user: true } },
};

export interface ListMessagesParams {
  conversationId: string;
  cursor?: string;
  limit: number;
}

/** Cursor-based pagination (createdAt+id) so a busy conversation's history loads incrementally, never all at once. */
export async function listMessages({ conversationId, cursor, limit }: ListMessagesParams) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    include: messageInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  return {
    items: page.reverse(), // chronological order for rendering
    nextCursor: hasMore ? page[0].id : null,
  };
}

export interface CreateOutboundMessageInput {
  conversationId: string;
  agentId: string;
  type: MessageType;
  body?: string | null;
  replyToMessageId?: string | null;
}

export async function createOutboundMessage(input: CreateOutboundMessageInput) {
  const conversation = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (!conversation) throw Errors.notFound("Conversa nao encontrada");
  if (conversation.assignedAgentId !== input.agentId) throw Errors.forbidden("Esta conversa pertence a outro atendente");
  if (!["IN_PROGRESS", "TRANSFERRED"].includes(conversation.status)) {
    throw Errors.badRequest("Conversa nao esta em atendimento");
  }

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      type: input.type,
      status: "PENDING",
      body: input.body ?? null,
      senderAgentId: input.agentId,
      replyToMessageId: input.replyToMessageId ?? null,
    },
    include: messageInclude,
  });

  const updates: Record<string, unknown> = { lastMessageAt: new Date(), lastMessageDirection: "OUTBOUND" };
  if (!conversation.firstResponseAt) updates.firstResponseAt = new Date();
  await prisma.conversation.update({ where: { id: input.conversationId }, data: updates });

  return message;
}

export async function markMessageSent(messageId: string, providerMessageId: string) {
  return prisma.message.update({
    where: { id: messageId },
    data: { status: "SENT", providerMessageId },
    include: messageInclude,
  });
}

export async function markMessageFailed(messageId: string) {
  return prisma.message.update({ where: { id: messageId }, data: { status: "FAILED" }, include: messageInclude });
}

export async function updateMessageStatusByProviderId(
  providerMessageId: string,
  status: "SENT" | "DELIVERED" | "READ" | "FAILED"
) {
  const message = await prisma.message.findUnique({ where: { providerMessageId } });
  if (!message) return null;
  return prisma.message.update({
    where: { id: message.id },
    data: {
      status,
      deliveredAt: status === "DELIVERED" || status === "READ" ? new Date() : message.deliveredAt,
      readAt: status === "READ" ? new Date() : message.readAt,
    },
    include: messageInclude,
  });
}

export interface CreateInboundMessageInput {
  conversationId: string;
  providerMessageId: string;
  type: MessageType;
  body: string | null;
  replyToProviderMessageId?: string | null;
}

export async function createInboundMessage(input: CreateInboundMessageInput) {
  const replyTo = input.replyToProviderMessageId
    ? await prisma.message.findUnique({ where: { providerMessageId: input.replyToProviderMessageId } })
    : null;

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: "INBOUND",
      type: input.type,
      status: "DELIVERED",
      body: input.body,
      providerMessageId: input.providerMessageId,
      replyToMessageId: replyTo?.id ?? null,
    },
    include: messageInclude,
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date(), lastMessageDirection: "INBOUND" },
  });

  return message;
}

export async function addAttachment(
  messageId: string,
  attachment: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    kind: MessageType;
    latitude?: number;
    longitude?: number;
    vcard?: string;
  }
) {
  return prisma.messageAttachment.create({ data: { messageId, ...attachment } });
}

export async function toggleReaction(messageId: string, userId: string, emoji: string | null) {
  const existing = await prisma.messageReaction.findFirst({ where: { messageId, userId, fromCustomer: false } });

  if (!emoji) {
    if (existing) await prisma.messageReaction.delete({ where: { id: existing.id } });
    return prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
  }

  if (existing) {
    await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
  } else {
    await prisma.messageReaction.create({ data: { messageId, userId, emoji, fromCustomer: false } });
  }
  return prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
}

export async function getMessageWithConversation(messageId: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!message) throw Errors.notFound("Mensagem nao encontrada");
  return message;
}

export { messageInclude };
