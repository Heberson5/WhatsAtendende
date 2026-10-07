import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { __getProviderForTests } from "../src/modules/whatsapp/whatsapp.service";
import { createClosingMessage } from "../src/modules/closing-messages/closing-messages.service";
import { updateSurveySettings } from "../src/modules/satisfaction/satisfaction.service";
import { CONVERSATION_UNDO_WINDOW_MS } from "@whatsatendende/types";
import type { MockWhatsAppProvider } from "@whatsatendende/whatsapp";
import { resetDatabase, createTestUser, createWaitingConversation, TEST_PASSWORD } from "./helpers";

const app = createApp();
const QUESTION = "De 0 a 10, o quanto você recomendaria o atendimento?";
const CLOSING_TEXT = "Obrigado, *{{cliente}}*! Foi um prazer atender você.";

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (!condition() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

function enableSurvey(connectionIds: string[]) {
  return updateSurveySettings({
    enabled: true,
    connectionScope: { allConnections: false, connectionIds },
    question: QUESTION,
    thanks: "Obrigado!",
    answerWindowHours: 24,
  });
}

describe("encerrar com a mensagem de encerramento e a pesquisa de satisfação ligadas", () => {
  let connectionId: string;
  let anaToken: string;
  let provider: MockWhatsAppProvider;

  beforeAll(async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-survey-flow@test.dev", role: "ADMIN" });
    const adminToken = await loginAs("admin-survey-flow@test.dev");
    const created = await request(app).post("/api/whatsapp/connections").set("Authorization", `Bearer ${adminToken}`).send({ name: "SuporteSurveyFlow" });
    connectionId = created.body.id;
    await request(app).post(`/api/whatsapp/connections/${connectionId}/connect`).set("Authorization", `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    provider = __getProviderForTests(connectionId) as MockWhatsAppProvider;

    const ana = await createTestUser({ email: "ana-survey-flow@test.dev", role: "AGENT", displayName: "Ana", whatsappConnectionId: connectionId });
    anaToken = await loginAs("ana-survey-flow@test.dev");
    await createClosingMessage({ name: "Padrão", text: CLOSING_TEXT, active: true, userIds: [ana.id], connectionScope: { allConnections: true, connectionIds: [] } });
  }, 20000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function acceptedConversation(phone: string) {
    const { conversation } = await createWaitingConversation(phone, connectionId);
    await prisma.contact.update({ where: { id: conversation.contactId }, data: { name: "Joana Cliente" } });
    const res = await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${anaToken}`);
    expect(res.status).toBe(200);
    return conversation;
  }

  it("a mensagem de encerramento espera os 10 segundos e sai logo antes da pesquisa", async () => {
    await enableSurvey([connectionId]);
    const conversation = await acceptedConversation("5511990007001");
    const before = provider.sentTexts.length;
    // Accepting may already have sent an Aceite auto-message (those templates outlive resetDatabase) — count from here.
    const outboundBefore = await prisma.message.count({ where: { conversationId: conversation.id, direction: "OUTBOUND" } });

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const closeRes = await request(app).post(`/api/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${anaToken}`);
    expect(closeRes.status).toBe(200);

    // Closed, but nothing has gone to the customer yet — the "Desfazer" window is still open.
    expect(provider.sentTexts.length).toBe(before);
    expect(await prisma.message.count({ where: { conversationId: conversation.id, direction: "OUTBOUND" } })).toBe(outboundBefore);

    await vi.advanceTimersByTimeAsync(CONVERSATION_UNDO_WINDOW_MS);
    vi.useRealTimers();
    await waitUntil(() => provider.sentTexts.length >= before + 2);

    const texts = provider.sentTexts.slice(before).map((m) => m.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("*Ana:*");
    expect(texts[0]).toContain("Obrigado, *Joana Cliente*! Foi um prazer atender você.");
    expect(texts[1]).toBe(QUESTION);

    const survey = await prisma.satisfactionSurvey.findUniqueOrThrow({ where: { conversationId: conversation.id }, include: { question: true } });
    expect(survey.question?.text).toBe(QUESTION);
    expect(survey.agentId).not.toBeNull();
  }, 20000);

  it("se o atendente desfaz o encerramento, nem a mensagem nem a pesquisa são enviadas", async () => {
    await enableSurvey([connectionId]);
    const conversation = await acceptedConversation("5511990007002");
    const before = provider.sentTexts.length;

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const closeRes = await request(app).post(`/api/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${anaToken}`);
    expect(closeRes.status).toBe(200);
    const undoRes = await request(app).post(`/api/conversations/${conversation.id}/undo`).set("Authorization", `Bearer ${anaToken}`);
    expect(undoRes.status).toBe(200);

    await vi.advanceTimersByTimeAsync(CONVERSATION_UNDO_WINDOW_MS);
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 500)); // give a wrongly-fired follow-up time to show up

    expect(provider.sentTexts.length).toBe(before);
    expect(await prisma.satisfactionSurvey.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("IN_PROGRESS");
  }, 20000);

  it("com a pesquisa ligada só para outra conexão, a mensagem de encerramento sai na hora, como antes", async () => {
    const other = await prisma.whatsAppConnection.create({ data: { name: "Vendas", status: "CONNECTED" } });
    await enableSurvey([other.id]);
    const conversation = await acceptedConversation("5511990007003");
    const before = provider.sentTexts.length;

    const closeRes = await request(app).post(`/api/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${anaToken}`);
    expect(closeRes.status).toBe(200);

    expect(provider.sentTexts.length).toBe(before + 1);
    expect(provider.sentTexts.at(-1)?.text).toContain("Obrigado, *Joana Cliente*");
  }, 20000);
});
