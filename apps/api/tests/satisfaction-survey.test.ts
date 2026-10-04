import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestConnection, createTestUser } from "./helpers";

const sent: { connectionId: string; phone: string; text: string }[] = [];
vi.mock("../src/modules/whatsapp/whatsapp.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/whatsapp/whatsapp.service")>();
  return {
    ...actual,
    sendAutomatedText: vi.fn(async (connectionId: string, _messageId: string, phone: string, text: string) => {
      sent.push({ connectionId, phone, text });
    }),
  };
});

import { closeConversation } from "../src/modules/conversations/conversations.service";
import { captureSurveyAnswer, getSatisfactionSummary, parseSurveyScore, updateSurveySettings } from "../src/modules/satisfaction/satisfaction.service";

const QUESTION = "De 1 a 5, como foi o atendimento?";

describe("Pesquisa de satisfação", () => {
  let connectionId: string;
  let agentId: string;

  beforeEach(async () => {
    await resetDatabase();
    sent.length = 0;
    connectionId = (await createTestConnection("Suporte")).id;
    agentId = (await createTestUser({ email: "ana@test.dev", role: "AGENT", whatsappConnectionId: connectionId })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function attendedConversation(phone: string, onConnection = connectionId) {
    const contact = await prisma.contact.create({ data: { phone, name: "Joana", whatsappConnectionId: onConnection } });
    const conversation = await prisma.conversation.create({
      data: { contactId: contact.id, whatsappConnectionId: onConnection, status: "IN_PROGRESS", assignedAgentId: agentId, enteredQueueAt: new Date(), acceptedAt: new Date(), lastMessageAt: new Date() },
    });
    return { contact, conversation };
  }

  function enable(connectionIds: string[]) {
    return updateSurveySettings({
      enabled: true,
      connectionScope: { allConnections: false, connectionIds },
      question: QUESTION,
      thanks: "Obrigado!",
      answerWindowHours: 24,
    });
  }

  it("fica desligada por padrão: encerrar não envia nada", async () => {
    const { conversation } = await attendedConversation("5511900000001");
    await closeConversation(conversation.id, agentId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(0);
    expect(await prisma.satisfactionSurvey.count()).toBe(0);
  });

  it("ligada para a conexão: pergunta ao encerrar, guarda a nota na conversa encerrada e agradece", async () => {
    await enable([connectionId]);
    const { contact, conversation } = await attendedConversation("5511900000002");
    await closeConversation(conversation.id, agentId);
    await vi.waitFor(() => expect(sent.map((m) => m.text)).toEqual([QUESTION]));

    const captured = await captureSurveyAnswer(connectionId, contact, { body: "nota 4", providerMessageId: "wamid-1" });
    expect(captured).toBe(true);
    expect(sent.at(-1)?.text).toBe("Obrigado!");
    const survey = await prisma.satisfactionSurvey.findUniqueOrThrow({ where: { conversationId: conversation.id } });
    expect(survey.score).toBe(4);
    expect(survey.agentId).toBe(agentId);
    expect(await prisma.conversation.count({ where: { contactId: contact.id } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: conversation.id, automatedBy: "SURVEY" } })).toBe(2);

    const summary = await getSatisfactionSummary({ from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) });
    expect(summary).toEqual({ sent: 1, answered: 1, average: 4, distribution: [0, 0, 0, 1, 0] });
  });

  it("não envia em conexão fora da lista", async () => {
    const other = await createTestConnection("Vendas");
    await enable([other.id]);
    const { conversation } = await attendedConversation("5511900000003");
    await closeConversation(conversation.id, agentId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(0);
  });

  it("uma resposta que não é nota encerra a pesquisa e segue o caminho normal", async () => {
    await enable([connectionId]);
    const { contact, conversation } = await attendedConversation("5511900000004");
    await closeConversation(conversation.id, agentId);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(await captureSurveyAnswer(connectionId, contact, { body: "preciso de outra coisa", providerMessageId: "wamid-2" })).toBe(false);
    expect(await captureSurveyAnswer(connectionId, contact, { body: "5", providerMessageId: "wamid-3" })).toBe(false);
  });

  it("reconhece a nota em respostas curtas", () => {
    expect(parseSurveyScore("5")).toBe(5);
    expect(parseSurveyScore(" 3 estrelas ")).toBe(3);
    expect(parseSurveyScore("6")).toBeNull();
    expect(parseSurveyScore("45")).toBeNull();
    expect(parseSurveyScore("o pedido 1 chegou quebrado, quero trocar")).toBeNull();
  });
});
