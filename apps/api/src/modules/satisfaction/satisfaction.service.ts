import type { Prisma } from "@prisma/client";
import { CONVERSATION_UNDO_WINDOW_MS, type SatisfactionQuestionSummaryDTO, type SatisfactionSummaryDTO, type SatisfactionSurveySettingsDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import type { ConnectionScopeInput } from "../../lib/connection-scope";
import { realtimeEvents } from "../../realtime/realtime";
import * as whatsappService from "../whatsapp/whatsapp.service";
import { createSystemOutboundMessage } from "../messages/messages.service";

/**
 * Pesquisa de satisfação (NPS). Off by default: nothing is ever sent until
 * someone switches it on (and picks the connections) in Respostas › Pesquisa.
 * When on, closing an attended WhatsApp conversation sends the question once
 * the "Desfazer" window has passed — right after the closing message, which
 * waits for that same window; the customer's next message, if it's a 0–10
 * score, is recorded on that closed conversation instead of opening a new one.
 *
 * Every question text is its own row (SatisfactionQuestion): changing the text
 * starts a new question, and the Dashboard keeps one NPS per question.
 */

const SETTINGS_KEY = "satisfactionSurvey";
// The API Oficial only delivers free text within 24h of the customer's last message.
const OFFICIAL_FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;
// A score answer is short ("10", "nota 9", "7 pontos") — anything longer is a new subject.
const MAX_SCORE_ANSWER_LENGTH = 20;
const MAX_SCORE = 10;
// NPS buckets: 9–10 promoters, 7–8 passives, 0–6 detractors.
const PROMOTER_MIN_SCORE = 9;
const PASSIVE_MIN_SCORE = 7;
// Surveys sent before the 0–10 scale existed have no question and were answered 1–5.
const LEGACY_QUESTION_LABEL = "Pesquisa anterior (nota de 1 a 5)";

export interface SurveySettings {
  enabled: boolean;
  allConnections: boolean;
  connectionIds: string[];
  question: string;
  /** The SatisfactionQuestion row for `question` — set when the settings are saved. */
  questionId: string | null;
  thanks: string;
  answerWindowHours: number;
}

const DEFAULT_SETTINGS: SurveySettings = {
  enabled: false,
  allConnections: false,
  connectionIds: [],
  question: "Em uma escala de 0 a 10, o quanto você recomendaria o nosso atendimento a um amigo ou colega? Responda apenas com o número, sendo 0 nada provável e 10 muito provável.",
  questionId: null,
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

/** The question row for this exact text — created the first time the text is used, reused if it comes back later. */
async function resolveQuestionId(text: string): Promise<string> {
  const existing = await prisma.satisfactionQuestion.findFirst({ where: { text }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (existing) return existing.id;
  return (await prisma.satisfactionQuestion.create({ data: { text }, select: { id: true } })).id;
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
    questionId: await resolveQuestionId(input.question),
    thanks: input.thanks,
    answerWindowHours: input.answerWindowHours,
  };
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key: SETTINGS_KEY }, update: { value: json }, create: { key: SETTINGS_KEY, value: json } });
  return value;
}

/** "10", "nota 9", "7 pontos" → the score (0–10); anything else → null. */
export function parseSurveyScore(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || trimmed.length > MAX_SCORE_ANSWER_LENGTH) return null;
  const match = /^\D*(\d{1,2})\D*$/.exec(trimmed);
  if (!match) return null;
  const score = Number(match[1]);
  return score <= MAX_SCORE ? score : null;
}

async function sendSurveyText(conversation: { id: string; whatsappConnectionId: string }, phone: string, text: string): Promise<void> {
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", type: "TEXT", status: "PENDING", body: text, automatedBy: "SURVEY" },
  });
  await whatsappService.sendAutomatedText(conversation.whatsappConnectionId, message.id, phone, text);
  realtimeEvents.newMessage(conversation.id, null);
}

const surveyConversationSelect = {
  id: true,
  status: true,
  channel: true,
  whatsappConnectionId: true,
  assignedAgentId: true,
  contactId: true,
  contact: { select: { phone: true } },
  whatsappConnection: { select: { connectionMode: true } },
  satisfactionSurvey: { select: { id: true } },
} satisfies Prisma.ConversationSelect;
type SurveyConversation = Prisma.ConversationGetPayload<{ select: typeof surveyConversationSelect }>;

/** Whether this conversation gets the survey once it is closed — status aside, so it also answers for one that is still open. */
async function isSurveyDue(conversation: SurveyConversation, settings: SurveySettings): Promise<boolean> {
  if (!settings.enabled || conversation.channel !== "WHATSAPP" || conversation.satisfactionSurvey) return false;
  // Only an attended conversation is rated — not one closed straight from the queue.
  if (!conversation.whatsappConnectionId || !conversation.assignedAgentId || !conversation.contact.phone) return false;
  if (!settings.allConnections && !settings.connectionIds.includes(conversation.whatsappConnectionId)) return false;

  if (conversation.whatsappConnection?.connectionMode === "OFFICIAL_API") {
    const lastInbound = await prisma.message.findFirst({
      where: { conversation: { contactId: conversation.contactId, whatsappConnectionId: conversation.whatsappConnectionId }, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lastInbound || Date.now() - lastInbound.createdAt.getTime() > OFFICIAL_FREE_TEXT_WINDOW_MS) return false;
  }
  return true;
}

/**
 * Asked before closing: when the survey will follow this close, the agent's
 * closing message is held back until the "Desfazer" window is over (it goes out
 * just before the survey) instead of being sent at once.
 */
export async function willSendSurveyOnClose(conversationId: string): Promise<boolean> {
  const settings = await getSurveySettings();
  if (!settings.enabled) return false;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: surveyConversationSelect });
  return conversation !== null && (await isSurveyDue(conversation, settings));
}

/** A closing message the close route held back — already rendered, with the person it is sent as. */
export interface HeldClosingMessage {
  text: string;
  senderId: string;
  senderDisplayName: string;
}

/**
 * Called when a person closes a conversation — waits out the "Desfazer" window,
 * then sends the held closing message (if any) and the survey, only if the
 * conversation is still closed.
 */
export function scheduleCloseFollowUp(conversationId: string, closingMessage?: HeldClosingMessage): void {
  setTimeout(() => void sendCloseFollowUp(conversationId, closingMessage), CONVERSATION_UNDO_WINDOW_MS).unref();
}

async function sendHeldClosingMessage(conversation: SurveyConversation, closing: HeldClosingMessage): Promise<void> {
  if (!conversation.whatsappConnectionId || !conversation.contact.phone) return;
  const message = await createSystemOutboundMessage({ conversationId: conversation.id, type: "TEXT", body: closing.text, agentId: closing.senderId, allowClosed: true });
  await whatsappService.sendOutboundText(conversation.whatsappConnectionId, message.id, conversation.contact.phone, closing.text, closing.senderDisplayName);
  realtimeEvents.newMessage(conversation.id, conversation.assignedAgentId);
}

export async function sendCloseFollowUp(conversationId: string, closingMessage?: HeldClosingMessage): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: surveyConversationSelect });
    // Undone (or otherwise reopened) during the "Desfazer" window — nothing goes out.
    if (!conversation || conversation.status !== "CLOSED") return;

    const settings = await getSurveySettings();
    const surveyDue = await isSurveyDue(conversation, settings);
    // Recorded before anything is sent, so a late "Desfazer" can no longer take the conversation back.
    const now = new Date();
    if (surveyDue) {
      await prisma.satisfactionSurvey.create({
        data: {
          conversationId,
          contactId: conversation.contactId,
          whatsappConnectionId: conversation.whatsappConnectionId!,
          agentId: conversation.assignedAgentId,
          questionId: settings.questionId ?? (await resolveQuestionId(settings.question)),
          sentAt: now,
          expiresAt: new Date(now.getTime() + settings.answerWindowHours * 60 * 60 * 1000),
        },
      });
    }

    if (closingMessage) {
      try {
        await sendHeldClosingMessage(conversation, closingMessage);
      } catch (err) {
        logger.error({ err, conversationId }, "failed to send held closing message");
      }
    }
    if (surveyDue) {
      await sendSurveyText({ id: conversationId, whatsappConnectionId: conversation.whatsappConnectionId! }, conversation.contact.phone!, settings.question);
    }
  } catch (err) {
    logger.error({ err, conversationId }, "failed to send closing follow-up");
  }
}

/**
 * Inbound hook: records a 0–10 answer to this contact's pending survey on this
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
  // questionId is null only on surveys from the old 1–5 scale, which no longer take answers.
  const survey = await prisma.satisfactionSurvey.findFirst({
    where: { contactId: contact.id, whatsappConnectionId: connectionId, answeredAt: null, expiresAt: { gt: now }, questionId: { not: null } },
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

interface NpsBreakdown {
  answered: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** (promoters − detractors) ÷ answered × 100, rounded; null while nobody answered. */
  nps: number | null;
}

/** NPS of a 0–10 distribution (index = score): 9–10 promoters, 7–8 passives, 0–6 detractors. */
export function calculateNps(distribution: number[]): NpsBreakdown {
  const count = (from: number, to: number) => distribution.slice(from, to + 1).reduce((sum, n) => sum + n, 0);
  const promoters = count(PROMOTER_MIN_SCORE, MAX_SCORE);
  const passives = count(PASSIVE_MIN_SCORE, PROMOTER_MIN_SCORE - 1);
  const detractors = count(0, PASSIVE_MIN_SCORE - 1);
  const answered = promoters + passives + detractors;
  return { answered, promoters, passives, detractors, nps: answered ? Math.round(((promoters - detractors) / answered) * 100) : null };
}

function summarizeQuestion(
  question: { questionId: string | null; question: string; current: boolean },
  rows: { score: number | null; count: number }[]
): SatisfactionQuestionSummaryDTO {
  const distribution = Array<number>(MAX_SCORE + 1).fill(0);
  let sent = 0;
  for (const row of rows) {
    sent += row.count;
    if (row.score !== null) distribution[row.score] += row.count;
  }
  const scaleMax = question.questionId === null ? 5 : 10;
  const answered = distribution.reduce((a, b) => a + b, 0);
  const total = distribution.reduce((sum, count, score) => sum + count * score, 0);
  const buckets = scaleMax === 10 ? calculateNps(distribution) : { promoters: 0, passives: 0, detractors: 0, nps: null };
  return {
    ...question,
    scaleMax,
    sent,
    answered,
    average: answered ? Math.round((total / answered) * 10) / 10 : null,
    distribution,
    promoters: buckets.promoters,
    passives: buckets.passives,
    detractors: buckets.detractors,
    nps: buckets.nps,
  };
}

export async function getSatisfactionSummary(params: { from: Date; to: Date; agentId?: string; connectionIds?: string[] }): Promise<SatisfactionSummaryDTO> {
  const where: Prisma.SatisfactionSurveyWhereInput = {
    sentAt: { gte: params.from, lte: params.to },
    ...(params.agentId && { agentId: params.agentId }),
    ...(params.connectionIds && { whatsappConnectionId: { in: params.connectionIds } }),
  };
  const [grouped, settings] = await Promise.all([
    prisma.satisfactionSurvey.groupBy({ by: ["questionId", "score"], where, _count: { _all: true } }),
    getSurveySettings(),
  ]);

  const rowsByQuestion = new Map<string | null, { score: number | null; count: number }[]>();
  for (const row of grouped) {
    const rows = rowsByQuestion.get(row.questionId) ?? [];
    rows.push({ score: row.score, count: row._count._all });
    rowsByQuestion.set(row.questionId, rows);
  }

  const questionIds = [...rowsByQuestion.keys()].filter((id): id is string => id !== null);
  const questions = questionIds.length
    ? await prisma.satisfactionQuestion.findMany({ where: { id: { in: questionIds } }, orderBy: { createdAt: "desc" } })
    : [];
  const summaries = questions.map((q) => summarizeQuestion({ questionId: q.id, question: q.text, current: q.text === settings.question }, rowsByQuestion.get(q.id) ?? []));
  // The question in use first, then the older ones (newest first, as fetched).
  summaries.sort((a, b) => Number(b.current) - Number(a.current));
  const legacyRows = rowsByQuestion.get(null);
  if (legacyRows) summaries.push(summarizeQuestion({ questionId: null, question: LEGACY_QUESTION_LABEL, current: false }, legacyRows));

  return {
    sent: summaries.reduce((sum, q) => sum + q.sent, 0),
    answered: summaries.reduce((sum, q) => sum + q.answered, 0),
    questions: summaries,
  };
}

/** NPS and number of answers per rated agent (0–10 scale only) — for Relatórios › Por atendente. */
export async function getSatisfactionByAgent(params: { from: Date; to: Date; connectionIds?: string[] }) {
  const rows = await prisma.satisfactionSurvey.groupBy({
    by: ["agentId", "score"],
    where: {
      sentAt: { gte: params.from, lte: params.to },
      score: { not: null },
      questionId: { not: null },
      ...(params.connectionIds && { whatsappConnectionId: { in: params.connectionIds } }),
    },
    _count: { _all: true },
  });
  const distributions = new Map<string, number[]>();
  for (const row of rows) {
    if (row.agentId === null || row.score === null) continue;
    const distribution = distributions.get(row.agentId) ?? Array<number>(MAX_SCORE + 1).fill(0);
    distribution[row.score] += row._count._all;
    distributions.set(row.agentId, distribution);
  }
  return new Map([...distributions].map(([agentId, distribution]) => {
    const { answered, nps } = calculateNps(distribution);
    return [agentId, { answered, nps }] as const;
  }));
}
