import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { findOrOpenConversationForInboundMessage } from "../src/modules/conversations/conversations.service";
import { resetDatabase, createTestUser, createTestConnection, createWaitingConversation, TEST_PASSWORD } from "./helpers";

// See PROMPT: "quando um atendente encerra a conversa ... durante este tempo o cliente envia uma mensagem, a conversa
// não deve ser encerrada, deve voltar para o mesmo atendente".

const app = createApp();

async function loginAs(email: string) {
  return (await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD })).body.accessToken as string;
}

describe("cliente responde logo após o encerramento", () => {
  let connectionId: string;
  let adminToken: string;
  let anaToken: string;
  let anaId: string;

  beforeAll(async () => {
    await resetDatabase();
    connectionId = (await createTestConnection("SuporteReopen")).id;
    await createTestUser({ email: "admin-reopen@test.dev", role: "ADMIN" });
    adminToken = await loginAs("admin-reopen@test.dev");
    anaId = (await createTestUser({ email: "ana-reopen@test.dev", role: "AGENT", displayName: "Ana", whatsappConnectionId: connectionId })).id;
    anaToken = await loginAs("ana-reopen@test.dev");
  });

  afterEach(async () => {
    await prisma.user.update({ where: { id: anaId }, data: { presence: "ONLINE", status: "ACTIVE" } });
    await prisma.systemSetting.deleteMany({ where: { key: "business" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const reload = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id } });

  async function closedConversation(phone: string) {
    const { conversation } = await createWaitingConversation(phone, connectionId);
    expect((await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${anaToken}`)).status).toBe(200);
    expect((await request(app).post(`/api/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${anaToken}`)).status).toBe(200);
    expect((await reload(conversation.id)).status).toBe("CLOSED");
    return conversation;
  }

  it("o cliente escreve logo depois: a mesma conversa volta para o mesmo atendente", async () => {
    const conversation = await closedConversation("5511990009001");
    const opened = await findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Esqueci de perguntar uma coisa");

    expect(opened.conversation.id).toBe(conversation.id);
    expect(opened.isNewConversation).toBe(false);
    expect("reopenedForAgentId" in opened && opened.reopenedForAgentId).toBe(anaId);
    const reopened = await reload(conversation.id);
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.assignedAgentId).toBe(anaId);
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedByUserId).toBeNull();
    expect(await prisma.conversation.count({ where: { contactId: conversation.contactId } })).toBe(1);
    expect(await prisma.conversationEvent.count({ where: { conversationId: conversation.id, type: "REOPENED" } })).toBe(1);

    // The attendant answers it like any conversation of theirs.
    const reply = await request(app).post(`/api/messages/conversations/${conversation.id}/text`).set("Authorization", `Bearer ${anaToken}`).send({ body: "Pode perguntar!" });
    expect(reply.status).toBe(201);
  });

  it("um obrigado fica na conversa encerrada: não reabre e nada entra na fila", async () => {
    const conversation = await closedConversation("5511990009002");
    const opened = await findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Muito obrigada! 🙏");

    expect(opened.conversation.id).toBe(conversation.id);
    expect("keptOnClosed" in opened && opened.keptOnClosed).toBe(true);
    expect((await reload(conversation.id)).status).toBe("CLOSED");
    expect(await prisma.conversation.count({ where: { contactId: conversation.contactId } })).toBe(1);

    // A picture with that caption is not a thank-you: the customer wants to talk.
    const picture = await findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "obrigada", false);
    expect("reopenedForAgentId" in picture && picture.reopenedForAgentId).toBe(anaId);
  });

  it("atendente em pausa recebe a conversa de volta; offline ou inativo, o cliente vai para a fila", async () => {
    const paused = await closedConversation("5511990009003");
    await prisma.user.update({ where: { id: anaId }, data: { presence: "AWAY" } });
    const back = await findOrOpenConversationForInboundMessage(connectionId, paused.contactId, "Voltei, tenho uma pergunta");
    expect(back.conversation.id).toBe(paused.id);
    expect((await reload(paused.id)).status).toBe("IN_PROGRESS");

    await prisma.user.update({ where: { id: anaId }, data: { presence: "ONLINE" } });
    const offline = await closedConversation("5511990009004");
    await prisma.user.update({ where: { id: anaId }, data: { presence: "OFFLINE" } });
    const queued = await findOrOpenConversationForInboundMessage(connectionId, offline.contactId, "Tem alguém aí?");
    expect(queued.isNewConversation).toBe(true);
    expect(queued.conversation.id).not.toBe(offline.id);
    expect(queued.conversation.status).toBe("NEW");
    expect(queued.conversation.assignedAgentId).toBeNull();
    expect((await reload(offline.id)).status).toBe("CLOSED");
    const created = await prisma.conversationEvent.findFirstOrThrow({ where: { conversationId: queued.conversation.id, type: "CREATED" } });
    expect(created.payload).toEqual({ returnedAfterCloseBy: "Ana" });

    await prisma.user.update({ where: { id: anaId }, data: { presence: "ONLINE" } });
    const inactive = await closedConversation("5511990009005");
    await prisma.user.update({ where: { id: anaId }, data: { status: "INACTIVE" } });
    expect((await findOrOpenConversationForInboundMessage(connectionId, inactive.contactId, "Oi?")).isNewConversation).toBe(true);
  });

  it("passado o tempo configurado, vale a regra de sempre: conversa nova na fila", async () => {
    const conversation = await closedConversation("5511990009006");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { closedAt: new Date(Date.now() - 6 * 60_000) } });

    const opened = await findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Bom dia, preciso de um exame");
    expect(opened.isNewConversation).toBe(true);
    expect(opened.conversation.status).toBe("NEW");
    expect((await reload(conversation.id)).status).toBe("CLOSED");
  });

  it("o tempo é configurável (1 a 60 minutos)", async () => {
    const patch = (minutes: unknown) => request(app).patch("/api/settings/business").set("Authorization", `Bearer ${adminToken}`).send({ reopenAfterCloseMinutes: minutes });
    expect((await patch(0)).status).toBe(400);
    expect((await patch(61)).status).toBe(400);
    expect((await patch(20)).status).toBe(200);

    const conversation = await closedConversation("5511990009007");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { closedAt: new Date(Date.now() - 6 * 60_000) } });
    const opened = await findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Oi, voltei");
    expect(opened.conversation.id).toBe(conversation.id);
    expect((await reload(conversation.id)).status).toBe("IN_PROGRESS");
  });

  it("duas mensagens chegando juntas reabrem a conversa uma vez só", async () => {
    const conversation = await closedConversation("5511990009008");
    const [a, b] = await Promise.all([
      findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Oi"),
      findOrOpenConversationForInboundMessage(connectionId, conversation.contactId, "Tudo bem?"),
    ]);
    expect(a.conversation.id).toBe(conversation.id);
    expect(b.conversation.id).toBe(conversation.id);
    expect(await prisma.conversation.count({ where: { contactId: conversation.contactId } })).toBe(1);
    expect(await prisma.conversationEvent.count({ where: { conversationId: conversation.id, type: "REOPENED" } })).toBe(1);
  });
});
