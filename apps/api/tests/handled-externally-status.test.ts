import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import * as conversationsService from "../src/modules/conversations/conversations.service";
import { resetDatabase, createTestConnection, createTestUser, createWaitingConversation } from "./helpers";

describe("reading a conversation from the linked phone (markConversationReadFromDevice)", () => {
  let connectionId: string;

  beforeEach(async () => {
    await resetDatabase();
    connectionId = (await createTestConnection("Suporte")).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("moves a still-queued (WAITING) conversation to HANDLED_EXTERNALLY, leaving the queue with no assigned agent", async () => {
    const { conversation } = await createWaitingConversation("5511990007777", connectionId);

    const result = await conversationsService.markConversationReadFromDevice(conversation.id);
    expect(result).toEqual({ leftQueue: true });

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("HANDLED_EXTERNALLY");
    expect(updated.assignedAgentId).toBeNull();
    expect(updated.assignedAgentReadAt).not.toBeNull();

    const queue = await conversationsService.listQueue([connectionId]);
    expect(queue.find((c) => c.id === conversation.id)).toBeUndefined();

    const event = await prisma.conversationEvent.findFirst({ where: { conversationId: conversation.id, type: "HANDLED_EXTERNALLY" } });
    expect(event).not.toBeNull();
  });

  it("leaves an already-assigned (IN_PROGRESS) conversation's status alone — only updates the read marker", async () => {
    const { conversation } = await createWaitingConversation("5511990008888", connectionId);
    const agent = await createTestUser({ email: "agente-he@test.dev", role: "AGENT", whatsappConnectionId: connectionId });
    await conversationsService.acceptConversation(conversation.id, agent.id);

    const result = await conversationsService.markConversationReadFromDevice(conversation.id);
    expect(result).toEqual({ leftQueue: false });

    const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.assignedAgentId).toBe(agent.id);
    expect(updated.assignedAgentReadAt).not.toBeNull();
  });

  it("moves a still-queued (WAITING) conversation to HANDLED_EXTERNALLY when replied to from the linked phone, same as reading it", async () => {
    const { contact, conversation } = await createWaitingConversation("5511990006666", connectionId);

    const result = await conversationsService.findOrOpenConversationForDeviceSentMessage(connectionId, contact.id);
    expect(result.isNewConversation).toBe(false);
    expect(result.leftQueue).toBe(true);
    expect(result.conversation.id).toBe(conversation.id);
    expect(result.conversation.status).toBe("HANDLED_EXTERNALLY");
    expect(result.conversation.assignedAgentId).toBeNull();
    expect(result.conversation.assignedAgentReadAt).not.toBeNull();

    const queue = await conversationsService.listQueue([connectionId]);
    expect(queue.find((c) => c.id === conversation.id)).toBeUndefined();

    const event = await prisma.conversationEvent.findFirst({ where: { conversationId: conversation.id, type: "HANDLED_EXTERNALLY" } });
    expect(event).not.toBeNull();
  });

  it("leaves an already-assigned (IN_PROGRESS) conversation's status alone when replied to from the phone — only refreshes the read marker", async () => {
    const { contact, conversation } = await createWaitingConversation("5511990005555", connectionId);
    const agent = await createTestUser({ email: "agente-devicereply@test.dev", role: "AGENT", whatsappConnectionId: connectionId });
    await conversationsService.acceptConversation(conversation.id, agent.id);

    const result = await conversationsService.findOrOpenConversationForDeviceSentMessage(connectionId, contact.id);
    expect(result.isNewConversation).toBe(false);
    expect(result.leftQueue).toBe(false);
    expect(result.conversation.status).toBe("IN_PROGRESS");
    expect(result.conversation.assignedAgentId).toBe(agent.id);
    expect(result.conversation.assignedAgentReadAt).not.toBeNull();
  });

  it("a further message from the same contact after HANDLED_EXTERNALLY opens a NEW conversation, unlike an ongoing NEW/WAITING/IN_PROGRESS one, and leaves the old row untouched", async () => {
    // HANDLED_EXTERNALLY isn't a deliberate "attendance finished" action by
    // an agent, so leaving it parked forever (no assigned agent, invisible
    // in Fila) used to silently swallow every message the customer sent
    // from then on. See PROMPT: "após atender uma conversa no celular ou
    // outro aplicativo... não está aparecendo na fila quando o cliente
    // manda novas mensagens".
    //
    // But updating that same row in place is also wrong: it overwrote
    // Entrada na fila/Aceite, erasing the earlier interaction from Gestão's
    // history. Each time the customer comes back after being handled
    // externally, it must be its OWN new row — see PROMPT: "cada vez que o
    // cliente iniciar uma nova conversa, deverá ter uma nova linha... não é
    // para sobrescrever o anterior".
    const { contact, conversation } = await createWaitingConversation("5511990009999", connectionId);
    const originalEnteredQueueAt = conversation.enteredQueueAt;
    await conversationsService.markConversationReadFromDevice(conversation.id);

    const { conversation: reopened, isNewConversation } = await conversationsService.findOrOpenConversationForInboundMessage(
      connectionId,
      contact.id
    );
    expect(isNewConversation).toBe(true);
    expect(reopened.id).not.toBe(conversation.id); // a brand new row, not the old one
    expect(reopened.status).toBe("NEW");
    expect(reopened.assignedAgentId).toBeNull();

    // The old row is untouched — still HANDLED_EXTERNALLY, own original timestamp.
    const old = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(old.status).toBe("HANDLED_EXTERNALLY");
    expect(old.enteredQueueAt).toEqual(originalEnteredQueueAt);

    const queue = await conversationsService.listQueue([connectionId]);
    expect(queue.find((c) => c.id === reopened.id)).toBeDefined();
    expect(queue.find((c) => c.id === conversation.id)).toBeUndefined();

    const event = await prisma.conversationEvent.findFirst({
      where: { conversationId: reopened.id, type: "CREATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect((event?.payload as { previousConversationId?: string } | null)?.previousConversationId).toBe(conversation.id);
  });

  it("a further @-mentioned message from the same contact after HANDLED_EXTERNALLY opens a NEW conversation and routes straight to that agent", async () => {
    const { contact, conversation } = await createWaitingConversation("5511990004444", connectionId);
    const agent = await createTestUser({ email: "agente-reopen-mention@test.dev", displayName: "Fernanda", role: "AGENT", whatsappConnectionId: connectionId });
    await conversationsService.markConversationReadFromDevice(conversation.id);

    const { conversation: reopened, isNewConversation, autoAssignedAgentId } = await conversationsService.findOrOpenConversationForInboundMessage(
      connectionId,
      contact.id,
      "Oi, pode ser a @Fernanda de novo?"
    );
    expect(isNewConversation).toBe(true);
    expect(reopened.id).not.toBe(conversation.id);
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.assignedAgentId).toBe(agent.id);
    expect(autoAssignedAgentId).toBe(agent.id);

    const old = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(old.status).toBe("HANDLED_EXTERNALLY");

    const mine = await conversationsService.listMyConversations(agent.id);
    expect(mine.find((c) => c.id === reopened.id)).toBeDefined();
  });
});
