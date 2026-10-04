import type { Prisma } from "@prisma/client";
import { CONVERSATION_UNDO_WINDOW_MS, type SatisfactionSummaryDTO, type SatisfactionSurveySettingsDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import type { ConnectionScopeInput } from "../../lib/connection-scope";
import { realtimeEvents } from "../../realtime/realtime";
import * as whatsappService from "../whatsapp/whatsapp.service";

/**
 * Pesquisa de satisfação. Off by default: nothing is ever sent until someone
 * switches it on (and picks the connections) in Respostas › Pesquisa. When on,
 * closing an attended WhatsApp conversation sends the question; the
 * customer's next message, if it's a 1–5 score, is recorded on that closed
 * conversation instead of opening a new one.
 */

const SETTINGS_KEY = "satisfactionSurvey";
// The API Oficial only delivers free text within 24h of the customer's last message.
const OFFICIAL_FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;
// A score answer is short ("5", "nota 4", "3 estrelas") — anything longer is a new subject.
const MAX_SCORE_ANSWER_LENGTH = 20;

export interface SurveySettings {
  enabled: boolean;
  allConnections: boolean;
  connectionIds: string[];
  question: string;
  thanks: string;
  answerWindowHours: number;
}

const DEFAULT_SETTINGS: SurveySettings = {
  enabled: false,
  allConnections: false,
  connectionIds: [],
  question: "Como você avalia o atendimento que recebeu? Responda com uma nota de 1 a 5, sendo 1 muito insatisfeito e 5 muito satisfeito.",
  thanks: "Obrigado pela sua avaliação!",
  answerWindowHours: 24,
};

export async function getSurveySettings(): Promise<SurveySettings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<SurveySettings> | undefined) };
}

export async function toSurveySettingsDTO(settings: SurveySettings): Promise<SatisfactionSurveySettingsDTO> {
  const connections = settings.allConnections
    ? []
    : await prisma.whatsAppConnection.findMany({ where: { id: { in: settings.connectionIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return {
    enabled: settings.enabled,
    connectionScope: { allConnections: settings.allConnections, connections },
    question: settings.question,
    thanks: settings.thanks,
    answerWindowHours: settings.answerWindowHours,
  };
}

export async function updateSurveySettings(input: {
  enabled: boolean;
  connectionScope: ConnectionScopeInput;
  question: string;
  thanks: string;
  answerWindowHours: number;
}): Promise<SurveySettings> {
  const value: SurveySettings = {
    enabled: input.enabled,
    allConnections: input.connectionScope.allConnections,
    connectionIds: input.connectionScope.allConnections ? [] : input.connectionScope.connectionIds,
    question: input.question,
    thanks: input.thanks,
    answerWindowHours: input.answerWindowHours,
  };
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key: SETTINGS_KEY }, update: { value: json }, create: { key: SETTINGS_KEY, value: json } });
  return value;
}

/** "5", "nota 4", "3 estrelas" → the score; anything else → null. */
export function parseSurveyScore(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length > MAX_SCORE_ANSWER_LENGTH) return null;
  const match = /^\D*([1-5])\D*$/.exec(trimmed);
  return match ? Number(match[1]) : null;
}

async function sendSurveyText(conversation: { id: string; whatsappConnectionId: string }, phone: string, text: string): Promise<void> {
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", type: "TEXT", status: "PENDING", body: text, automatedBy: "SURVEY" },
  });
  await whatsappService.sendAutomatedText(conversation.whatsappConnectionId, message.id, phone, text);
  realtimeEvents.newMessage(conversation.id, null);
}

/** Called when a person closes a conversation — waits out the "Desfazer" window, then sends only if it's still closed. */
export function scheduleSatisfactionSurvey(conversationId: string): void {
  setTimeout(() => void sendSatisfactionSurvey(conversationId), CONVERSATION_UNDO_WINDOW_MS).unref();
}

export async function sendSatisfactionSurvey(conversationId: string): Promise<void> {
  try {
    const settings = await getSurveySettings();
    if (!settings.enabled) return;
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        status: true,
        channel: true,
        whatsappConnectionId: true,
        assignedAgentId: true,
        contactId: true,
        contact: { select: { phone: true } },
        whatsappConnection: { select: { connectionMode: true } },
        satisfactionSurvey: { select: { id: true } },
      },
    });
    if (!conversation || conversation.status !== "CLOSED" || conversation.channel !== "WHATSAPP" || conversation.satisfactionSurvey) return;
    // Only an attended conversation is rated — not one closed straight from the queue.
    if (!conversation.whatsappConnectionId || !conversation.assignedAgentId || !conversation.contact.phone) return;
    if (!settings.allConnections && !settings.connectionIds.includes(conversation.whatsappConnectionId)) return;

    if (conversation.whatsappConnection?.connectionMode === "OFFICIAL_API") {
      const lastInbound = await prisma.message.findFirst({
        where: { conversation: { contactId: conversation.contactId, whatsappConnectionId: conversation.whatsappConnectionId }, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!lastInbound || Date.now() - lastInbound.createdAt.getTime() > OFFICIAL_FREE_TEXT_WINDOW_MS) return;
    }

    const now = new Date();
    await prisma.satisfactionSurvey.create({
      data: {
        conversationId,
        contactId: conversation.contactId,
        whatsappConnectionId: conversation.whatsappConnectionId,
        agentId: conversation.assignedAgentId,
        sentAt: now,
        expiresAt: new Date(now.getTime() + settings.answerWindowHours * 60 * 60 * 1000),
      },
    });
    await sendSurveyText({ id: conversationId, whatsappConnectionId: conversation.whatsappConnectionId }, conversation.contact.phone, settings.question);
  } catch (err) {
    logger.error({ err, conversationId }, "failed to send satisfaction survey");
  }
}

/**
 * Inbound hook: records a 1–5 answer to this contact's pending survey on this
 * connection. Returns true when the message was the answer (stored on the
 * closed conversation — no new conversation opens). Any other message ends
 * the survey unanswered and follows the normal path.
 */
export async function captureSurveyAnswer(
  connectionId: string,
  contact: { id: string; phone: string | null },
  message: { body: string | null; providerMessageId: string }
): Promise<boolean> {
  const now = new Date();
  const survey = await prisma.satisfactionSurvey.findFirst({
    where: { contactId: contact.id, whatsappConnectionId: connectionId, answeredAt: null, expiresAt: { gt: now } },
    orderBy: { sentAt: "desc" },
  });
  if (!survey) return false;
  // Someone already started a newer conversation with this customer — that one owns the chat now.
  const newer = await prisma.conversation.count({ where: { contactId: contact.id, createdAt: { gt: survey.sentAt } } });
  if (newer > 0) return false;

  const score = parseSurveyScore(message.body);
  if (score === null) {
    await prisma.satisfactionSurvey.update({ where: { id: survey.id }, data: { expiresAt: now } });
    return false;
  }

  await prisma.satisfactionSurvey.update({ where: { id: survey.id }, data: { score, answeredAt: now } });
  await prisma.message.create({
    data: {
      conversationId: survey.conversationId,
      direction: "INBOUND",
      type: "TEXT",
      status: "DELIVERED",
      body: message.body,
      providerMessageId: message.providerMessageId,
    },
  });
  const settings = await getSurveySettings();
  if (contact.phone) await sendSurveyText({ id: survey.conversationId, whatsappConnectionId: connectionId }, contact.phone, settings.thanks);
  return true;
}

export async function getSatisfactionSummary(params: { from: Date; to: Date; agentId?: string; connectionIds?: string[] }): Promise<SatisfactionSummaryDTO> {
  const where: Prisma.SatisfactionSurveyWhereInput = {
    sentAt: { gte: params.from, lte: params.to },
    ...(params.agentId && { agentId: params.agentId }),
    ...(params.connectionIds && { whatsappConnectionId: { in: params.connectionIds } }),
  };
  const [sent, byScore] = await Promise.all([
    prisma.satisfactionSurvey.count({ where }),
    prisma.satisfactionSurvey.groupBy({ by: ["score"], where: { ...where, score: { not: null } }, _count: { _all: true } }),
  ]);
  const distribution: SatisfactionSummaryDTO["distribution"] = [0, 0, 0, 0, 0];
  for (const row of byScore) distribution[row.score! - 1] = row._count._all;
  const answered = distribution.reduce((a, b) => a + b, 0);
  const total = distribution.reduce((sum, count, i) => sum + count * (i + 1), 0);
  return { sent, answered, average: answered ? Math.round((total / answered) * 10) / 10 : null, distribution };
}

/** Average score and number of answers per rated agent — for Relatórios › Por atendente. */
export async function getSatisfactionByAgent(params: { from: Date; to: Date; connectionIds?: string[] }) {
  const rows = await prisma.satisfactionSurvey.groupBy({
    by: ["agentId"],
    where: {
      sentAt: { gte: params.from, lte: params.to },
      score: { not: null },
      ...(params.connectionIds && { whatsappConnectionId: { in: params.connectionIds } }),
    },
    _avg: { score: true },
    _count: { score: true },
  });
  return new Map(rows.map((r) => [r.agentId, { answered: r._count.score, average: r._avg.score === null ? null : Math.round(r._avg.score * 10) / 10 }]));
}
