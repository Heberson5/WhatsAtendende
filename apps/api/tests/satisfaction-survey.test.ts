import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestConnection, createTestUser } from "./helpers";

const sent: { connectionId: string; phone: string; text: string; sender?: string }[] = [];
vi.mock("../src/modules/whatsapp/whatsapp.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/whatsapp/whatsapp.service")>();
  return {
    ...actual,
    sendAutomatedText: vi.fn(async (connectionId: string, _messageId: string, phone: string, text: string) => {
      sent.push({ connectionId, phone, text });
    }),
    sendOutboundText: vi.fn(async (connectionId: string, _messageId: string, phone: string, text: string, sender: string) => {
      sent.push({ connectionId, phone, text, sender });
    }),
  };
});

// Loaded before conversations.service so it binds to the mocked whatsapp.service (the modules import each other).
import {
  calculateNps,
  captureSurveyAnswer,
  getSatisfactionByAgent,
  getSatisfactionSummary,
  parseSurveyScore,
  sendCloseFollowUp,
  updateSurveySettings,
  willSendSurveyOnClose,
} from "../src/modules/satisfaction/satisfaction.service";
import { closeConversation, undoLastConversationAction } from "../src/modules/conversations/conversations.service";

const QUESTION = "De 0 a 10, o quanto você recomendaria o atendimento?";
const NEW_QUESTION = "De 0 a 10, qual a chance de você voltar a falar com a gente?";
const CLOSING = { text: "Obrigada pelo contato!", senderDisplayName: "Ana" };
const PERIOD = () => ({ from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) });

describe("Pesquisa de satisfação (NPS)", () => {
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

  function configure(connectionIds: string[], question = QUESTION, enabled = true) {
    return updateSurveySettings({
      enabled,
      connectionScope: { allConnections: false, connectionIds },
      question,
      thanks: "Obrigado!",
      answerWindowHours: 24,
    });
  }

  /** Closes the conversation and answers the survey, like a customer would. */
  async function closeAndAnswer(phone: string, answer: string) {
    const { contact, conversation } = await attendedConversation(phone);
    await closeConversation(conversation.id, agentId);
    await sendCloseFollowUp(conversation.id); // what the timer does after the "Desfazer" window
    expect(await captureSurveyAnswer(connectionId, contact, { body: answer, providerMessageId: `wamid-${phone}` })).toBe(true);
    return { contact, conversation };
  }

  it("fica desligada por padrão: encerrar não envia nada", async () => {
    const { conversation } = await attendedConversation("5511900000001");
    await closeConversation(conversation.id, agentId);
    await sendCloseFollowUp(conversation.id);
    expect(sent).toHaveLength(0);
    expect(await prisma.satisfactionSurvey.count()).toBe(0);
  });

  it("ligada para a conexão: pergunta ao encerrar, guarda a nota de 0 a 10 na conversa encerrada e agradece", async () => {
    await configure([connectionId]);
    const { contact, conversation } = await attendedConversation("5511900000002");
    await closeConversation(conversation.id, agentId);
    await sendCloseFollowUp(conversation.id);
    expect(sent.map((m) => m.text)).toEqual([QUESTION]);

    expect(await captureSurveyAnswer(connectionId, contact, { body: "nota 9", providerMessageId: "wamid-1" })).toBe(true);
    expect(sent.at(-1)?.text).toBe("Obrigado!");
    const survey = await prisma.satisfactionSurvey.findUniqueOrThrow({ where: { conversationId: conversation.id }, include: { question: true } });
    expect(survey.score).toBe(9);
    expect(survey.agentId).toBe(agentId);
    expect(survey.question?.text).toBe(QUESTION);
    expect(await prisma.conversation.count({ where: { contactId: contact.id } })).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: conversation.id, automatedBy: "SURVEY" } })).toBe(2);

    const summary = await getSatisfactionSummary(PERIOD());
    expect(summary).toEqual({
      sent: 1,
      answered: 1,
      questions: [
        {
          questionId: survey.questionId,
          question: QUESTION,
          current: true,
          scaleMax: 10,
          sent: 1,
          answered: 1,
          average: 9,
          distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
          promoters: 1,
          passives: 0,
          detractors: 0,
          nps: 100,
        },
      ],
    });
  });

  it("aceita a nota zero e o dez", async () => {
    await configure([connectionId]);
    await closeAndAnswer("5511900000020", "0");
    await closeAndAnswer("5511900000021", "10");
    const [question] = (await getSatisfactionSummary(PERIOD())).questions;
    expect(question.distribution[0]).toBe(1);
    expect(question.distribution[10]).toBe(1);
    expect(question).toMatchObject({ answered: 2, average: 5, promoters: 1, detractors: 1, nps: 0 });
  });

  it("não envia em conexão fora da lista", async () => {
    const other = await createTestConnection("Vendas");
    await configure([other.id]);
    const { conversation } = await attendedConversation("5511900000003");
    await closeConversation(conversation.id, agentId);
    await sendCloseFollowUp(conversation.id);
    expect(sent).toHaveLength(0);
  });

  it("uma resposta que não é nota encerra a pesquisa e segue o caminho normal", async () => {
    await configure([connectionId]);
    const { contact, conversation } = await attendedConversation("5511900000004");
    await closeConversation(conversation.id, agentId);
    await sendCloseFollowUp(conversation.id);
    expect(sent).toHaveLength(1);

    expect(await captureSurveyAnswer(connectionId, contact, { body: "preciso de outra coisa", providerMessageId: "wamid-2" })).toBe(false);
    expect(await captureSurveyAnswer(connectionId, contact, { body: "5", providerMessageId: "wamid-3" })).toBe(false);
  });

  it("reconhece a nota em respostas curtas", () => {
    expect(parseSurveyScore("5")).toBe(5);
    expect(parseSurveyScore("0")).toBe(0);
    expect(parseSurveyScore("10")).toBe(10);
    expect(parseSurveyScore(" 9 pontos ")).toBe(9);
    expect(parseSurveyScore("nota 7!")).toBe(7);
    expect(parseSurveyScore("11")).toBeNull();
    expect(parseSurveyScore("100")).toBeNull();
    expect(parseSurveyScore("45")).toBeNull();
    expect(parseSurveyScore("de 3 a 4")).toBeNull();
    expect(parseSurveyScore("o pedido 1 chegou quebrado, quero trocar")).toBeNull();
  });

  describe("NPS", () => {
    it("calcula promotores (9–10), neutros (7–8) e detratores (0–6)", () => {
      // 0, 6, 8, 9, 9, 10 → 3 promotores, 1 neutro, 2 detratores
      const distribution = [1, 0, 0, 0, 0, 0, 1, 0, 1, 2, 1];
      expect(calculateNps(distribution)).toEqual({ answered: 6, promoters: 3, passives: 1, detractors: 2, nps: 17 });
      expect(calculateNps(Array(11).fill(0))).toEqual({ answered: 0, promoters: 0, passives: 0, detractors: 0, nps: null });
      expect(calculateNps([0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0]).nps).toBe(0);
    });

    it("mostra o NPS de cada pergunta e mantém a anterior no histórico quando o texto muda", async () => {
      await configure([connectionId]);
      await closeAndAnswer("5511900000030", "10");
      await closeAndAnswer("5511900000031", "9");

      await configure([connectionId], NEW_QUESTION);
      await closeAndAnswer("5511900000032", "3");
      await closeAndAnswer("5511900000033", "8");

      const summary = await getSatisfactionSummary(PERIOD());
      expect(summary).toMatchObject({ sent: 4, answered: 4 });
      expect(summary.questions.map((q) => ({ question: q.question, current: q.current, answered: q.answered, nps: q.nps }))).toEqual([
        { question: NEW_QUESTION, current: true, answered: 2, nps: -50 },
        { question: QUESTION, current: false, answered: 2, nps: 100 },
      ]);
      expect(await prisma.satisfactionQuestion.count()).toBe(2);
    });

    it("voltar ao texto de antes retoma o NPS daquela pergunta", async () => {
      await configure([connectionId]);
      await closeAndAnswer("5511900000040", "10");
      await configure([connectionId], NEW_QUESTION);
      await configure([connectionId], QUESTION);
      await closeAndAnswer("5511900000041", "2");

      const summary = await getSatisfactionSummary(PERIOD());
      expect(summary.questions).toHaveLength(1);
      expect(summary.questions[0]).toMatchObject({ question: QUESTION, current: true, answered: 2, nps: 0 });
      expect(await prisma.satisfactionQuestion.count()).toBe(2); // the new wording was saved once, never answered
    });

    it("só lista as perguntas enviadas no período", async () => {
      await configure([connectionId]);
      await closeAndAnswer("5511900000050", "9");
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await prisma.satisfactionSurvey.updateMany({ data: { sentAt: old } });
      await configure([connectionId], NEW_QUESTION);

      expect(await getSatisfactionSummary(PERIOD())).toEqual({ sent: 0, answered: 0, questions: [] });
    });

    it("o que foi enviado na escala antiga (1 a 5) aparece à parte, sem NPS, e não recebe respostas novas", async () => {
      await configure([connectionId]);
      const { contact, conversation } = await attendedConversation("5511900000060");
      await closeConversation(conversation.id, agentId);
      await prisma.satisfactionSurvey.create({
        data: { conversationId: conversation.id, contactId: contact.id, whatsappConnectionId: connectionId, agentId, score: 4, sentAt: new Date(), expiresAt: new Date(), answeredAt: new Date() },
      });
      const pending = await attendedConversation("5511900000061");
      await closeConversation(pending.conversation.id, agentId);
      await prisma.satisfactionSurvey.create({
        data: { conversationId: pending.conversation.id, contactId: pending.contact.id, whatsappConnectionId: connectionId, agentId, sentAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
      });

      const summary = await getSatisfactionSummary(PERIOD());
      expect(summary.questions).toHaveLength(1);
      expect(summary.questions[0]).toMatchObject({ questionId: null, scaleMax: 5, sent: 2, answered: 1, average: 4, nps: null });
      expect(await captureSurveyAnswer(connectionId, pending.contact, { body: "8", providerMessageId: "wamid-legacy" })).toBe(false);
    });

    it("calcula o NPS por atendente só com as notas de 0 a 10", async () => {
      await configure([connectionId]);
      await closeAndAnswer("5511900000070", "10");
      await closeAndAnswer("5511900000071", "2");
      await closeAndAnswer("5511900000072", "9");
      const byAgent = await getSatisfactionByAgent(PERIOD());
      expect(byAgent.get(agentId)).toEqual({ answered: 3, nps: 33 });
    });
  });

  describe("mensagem de encerramento com a pesquisa ligada", () => {
    it("com a pesquisa a caminho, a mensagem espera a janela do Desfazer e sai logo antes da pergunta", async () => {
      await configure([connectionId]);
      const { conversation } = await attendedConversation("5511900000080");
      expect(await willSendSurveyOnClose(conversation.id)).toBe(true);

      const held = { ...CLOSING, senderId: agentId };
      await closeConversation(conversation.id, agentId, held);
      expect(sent).toHaveLength(0); // nothing leaves while the "Desfazer" window is open

      await sendCloseFollowUp(conversation.id, held);
      expect(sent.map((m) => m.text)).toEqual([CLOSING.text, QUESTION]);
      expect(sent[0].sender).toBe("Ana"); // the closing message still goes out as the agent
      const message = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, body: CLOSING.text } });
      expect(message).toMatchObject({ direction: "OUTBOUND", senderAgentId: agentId, automatedBy: null });
    });

    it("se o atendente desfaz dentro da janela, nem a mensagem nem a pesquisa são enviadas", async () => {
      await configure([connectionId]);
      const { conversation } = await attendedConversation("5511900000081");
      const held = { ...CLOSING, senderId: agentId };
      await closeConversation(conversation.id, agentId, held);
      await undoLastConversationAction(conversation.id, agentId);

      await sendCloseFollowUp(conversation.id, held); // the timer still fires
      expect(sent).toHaveLength(0);
      expect(await prisma.satisfactionSurvey.count()).toBe(0);
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("IN_PROGRESS");
    });

    it("depois que a mensagem e a pesquisa saíram, não dá mais para desfazer", async () => {
      await configure([connectionId]);
      const { conversation } = await attendedConversation("5511900000082");
      await closeConversation(conversation.id, agentId, { ...CLOSING, senderId: agentId });
      await sendCloseFollowUp(conversation.id, { ...CLOSING, senderId: agentId });

      await expect(undoLastConversationAction(conversation.id, agentId)).rejects.toThrow("Não é mais possível desfazer esta ação");
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("CLOSED");
    });

    it("se a pesquisa foi desligada durante a janela, a mensagem de encerramento sai mesmo assim", async () => {
      await configure([connectionId]);
      const { conversation } = await attendedConversation("5511900000083");
      const held = { ...CLOSING, senderId: agentId };
      await closeConversation(conversation.id, agentId, held);
      await configure([connectionId], QUESTION, false);

      await sendCloseFollowUp(conversation.id, held);
      expect(sent.map((m) => m.text)).toEqual([CLOSING.text]);
      expect(await prisma.satisfactionSurvey.count()).toBe(0);
    });

    it("sem pesquisa para essa conversa, a mensagem não é retida", async () => {
      const { conversation } = await attendedConversation("5511900000084");
      expect(await willSendSurveyOnClose(conversation.id)).toBe(false); // survey off

      const other = await createTestConnection("Vendas");
      await configure([other.id]);
      expect(await willSendSurveyOnClose(conversation.id)).toBe(false); // survey on, but not for this connection

      await configure([connectionId]);
      await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedAgentId: null } });
      expect(await willSendSurveyOnClose(conversation.id)).toBe(false); // nobody attended it
    });
  });
});
