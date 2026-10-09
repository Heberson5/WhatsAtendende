import type { Prisma, SatisfactionSurveyConfig } from "@prisma/client";
import { CONVERSATION_UNDO_WINDOW_MS, type SatisfactionQuestionSummaryDTO, type SatisfactionSummaryDTO, type SatisfactionSurveyDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { Errors } from "../../lib/http-error";
import { appliesToConnection, assertScopeConnectionsExist, scopeData, toConnectionScopeDTO, withScopeConnections, type ConnectionScopeInput } from "../../lib/connection-scope";
import { realtimeEvents } from "../../realtime/realtime";
import * as whatsappService from "../whatsapp/whatsapp.service";
import { createSystemOutboundMessage } from "../messages/messages.service";
import { isGratitudeMessage } from "./gratitude";

/**
 * Pesquisa de satisfação (NPS). Respostas › Pesquisa holds a list of surveys
 * (SatisfactionSurveyConfig) — the ones that ship are templates, all off: nothing
 * is ever sent until someone switches one on (and picks the connections). When
 * one applies, closing an attended WhatsApp conversation sends its question once
 * the "Desfazer" window has passed; the customer's next message, if it's a 0–10
 * score, is recorded on that closed conversation instead of opening a new one.
 *
 * The agent's closing message does not go out with the question: it is kept on
 * the survey row and goes out 10 seconds after the score — or, if the customer
 * never answers, after the configured wait (30 minutes by default). While it
 * waits, a plain "obrigado" from the customer changes nothing (the deadline
 * stays), but anything else means they want to talk: the closing message is
 * dropped and the message opens a new conversation. A sweep (see
 * processDueClosingMessages) sends what is due, so the wait survives a restart.
 *
 * Every question text is its own row (SatisfactionQuestion): changing the text
 * starts a new question, and the Dashboard keeps one NPS per question.
 */

// The API Oficial only delivers free text within 24h of the customer's last message.
const OFFICIAL_FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;
// The closing message follows the customer's score by this long.
const CLOSING_AFTER_ANSWER_MS = 10_000;
export const DEFAULT_CLOSING_WAIT_MINUTES = 30;
// A score answer is short ("10", "nota 9", "7 pontos") — anything longer is a new subject.
const MAX_SCORE_ANSWER_LENGTH = 20;
const MAX_SCORE = 10;
// NPS buckets: 9–10 promoters, 7–8 passives, 0–6 detractors.
const PROMOTER_MIN_SCORE = 9;
const PASSIVE_MIN_SCORE = 7;
// Surveys sent before the 0–10 scale existed have no question and were answered 1–5.
const LEGACY_QUESTION_LABEL = "Pesquisa anterior (nota de 1 a 5)";
// For a score on a survey whose setup was deleted in the meantime.
const DEFAULT_THANKS = "Obrigado pela sua avaliação!";

type SurveyRow = SatisfactionSurveyConfig & { connections: { id: string; name: string }[] };

export interface SurveyInput {
  name: string;
  active: boolean;
  connectionScope: ConnectionScopeInput;
  question: string;
  thanks: string;
  answerWindowHours: number;
  closingWaitMinutes: number;
}

export function toSurveyDTO(row: SurveyRow): SatisfactionSurveyDTO {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    connectionScope: toConnectionScopeDTO(row),
    question: row.question,
    thanks: row.thanks,
    answerWindowHours: row.answerWindowHours,
    closingWaitMinutes: row.closingWaitMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every survey — the ones switched on first. */
export async function listSurveys(): Promise<SurveyRow[]> {
  return prisma.satisfactionSurveyConfig.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: withScopeConnections });
}

export async function getSurvey(id: string): Promise<SurveyRow> {
  const row = await prisma.satisfactionSurveyConfig.findUnique({ where: { id }, include: withScopeConnections });
  if (!row) throw Errors.notFound("Pesquisa não encontrada");
  return row;
}

export async function createSurvey({ connectionScope, ...input }: SurveyInput): Promise<SurveyRow> {
  await assertScopeConnectionsExist(connectionScope);
  return prisma.satisfactionSurveyConfig.create({ data: { ...input, ...scopeData(connectionScope, "connect") }, include: withScopeConnections });
}

export async function updateSurvey(id: string, { connectionScope, ...input }: Partial<SurveyInput>): Promise<SurveyRow> {
  await getSurvey(id);
  if (connectionScope) await assertScopeConnectionsExist(connectionScope);
  return prisma.satisfactionSurveyConfig.update({
    where: { id },
    data: { ...input, ...(connectionScope && scopeData(connectionScope, "set")) },
    include: withScopeConnections,
  });
}

/** Surveys already sent keep their scores (and their question in the Dashboard). */
export async function deleteSurvey(id: string): Promise<void> {
  await getSurvey(id);
  await prisma.satisfactionSurveyConfig.delete({ where: { id } });
}

/**
 * The survey sent on conversations of this connection — among the ACTIVE ones that apply, the one chosen for the
 * connection over an "all connections" one, then the most recently updated. Null when none is on for it.
 */
export async function getSurveyFor(whatsappConnectionId: string | null): Promise<SatisfactionSurveyConfig | null> {
  if (!whatsappConnectionId) return null;
  const rows = await prisma.satisfactionSurveyConfig.findMany({
    where: { active: true, ...appliesToConnection(whatsappConnectionId) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.find((r) => !r.allConnections) ?? rows[0] ?? null;
}

/** The question row for this exact text — created the first time the text is used, reused if it comes back later. */
async function resolveQuestionId(text: string): Promise<string> {
  const existing = await prisma.satisfactionQuestion.findFirst({ where: { text }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (existing) return existing.id;
  return (await prisma.satisfactionQuestion.create({ data: { text }, select: { id: true } })).id;
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
  closedAt: true,
  contact: { select: { phone: true } },
  whatsappConnection: { select: { connectionMode: true } },
  satisfactionSurvey: { select: { id: true } },
} satisfies Prisma.ConversationSelect;
type SurveyConversation = Prisma.ConversationGetPayload<{ select: typeof surveyConversationSelect }>;

/**
 * The survey this conversation gets once it is closed — status aside, so it also answers for one that is still
 * open. Null when none is due.
 */
async function surveyDueFor(conversation: SurveyConversation): Promise<SatisfactionSurveyConfig | null> {
  if (conversation.channel !== "WHATSAPP" || conversation.satisfactionSurvey) return null;
  // Only an attended conversation is rated — not one closed straight from the queue.
  if (!conversation.whatsappConnectionId || !conversation.assignedAgentId || !conversation.contact.phone) return null;
  const survey = await getSurveyFor(conversation.whatsappConnectionId);
  if (!survey) return null;

  if (conversation.whatsappConnection?.connectionMode === "OFFICIAL_API") {
    const lastInbound = await prisma.message.findFirst({
      where: { conversation: { contactId: conversation.contactId, whatsappConnectionId: conversation.whatsappConnectionId }, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lastInbound || Date.now() - lastInbound.createdAt.getTime() > OFFICIAL_FREE_TEXT_WINDOW_MS) return null;
  }
  return survey;
}

/**
 * Asked before closing: when the survey will follow this close, the agent's
 * closing message is held back (it goes out once the customer has answered, or
 * when the wait runs out) instead of being sent at once.
 */
export async function willSendSurveyOnClose(conversationId: string): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: surveyConversationSelect });
  return conversation !== null && (await surveyDueFor(conversation)) !== null;
}

/** A closing message the close route held back — already rendered, with the person it is sent as. */
export interface HeldClosingMessage {
  text: string;
  senderId: string;
  senderDisplayName: string;
}

/**
 * Called when a person closes a conversation — waits out the "Desfazer" window,
 * then sends the survey question (and, if the survey no longer applies, the held
 * closing message), only if the conversation is still closed.
 */
export function scheduleCloseFollowUp(conversationId: string, closingMessage?: HeldClosingMessage): void {
  setTimeout(() => void sendCloseFollowUp(conversationId, closingMessage), CONVERSATION_UNDO_WINDOW_MS).unref();
}

/** Whether a conversation with this customer was started after `since` — it owns the chat from then on. */
async function hasConversationSince(contactId: string, since: Date): Promise<boolean> {
  return (await prisma.conversation.count({ where: { contactId, createdAt: { gt: since } } })) > 0;
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
    // Closed, undone and closed again inside the window leaves two timers behind — the first one already did this.
    if (conversation.satisfactionSurvey) return;
    // The customer wrote again during the window: that new conversation owns the chat, and neither the question nor a goodbye fits it.
    if (conversation.closedAt && (await hasConversationSince(conversation.contactId, conversation.closedAt))) return;

    const survey = await surveyDueFor(conversation);
    if (!survey) {
      // The survey was switched off (or stopped applying) during the window — nothing to wait for, the closing message goes out now.
      if (closingMessage) {
        try {
          await sendHeldClosingMessage(conversation, closingMessage);
        } catch (err) {
          logger.error({ err, conversationId }, "failed to send held closing message");
        }
      }
      return;
    }

    // Recorded before anything is sent, so a late "Desfazer" can no longer take the conversation back.
    const now = new Date();
    const waitMinutes = Math.min(survey.closingWaitMinutes, survey.answerWindowHours * 60);
    await prisma.satisfactionSurvey.create({
      data: {
        conversationId,
        contactId: conversation.contactId,
        whatsappConnectionId: conversation.whatsappConnectionId!,
        agentId: conversation.assignedAgentId,
        configId: survey.id,
        questionId: await resolveQuestionId(survey.question),
        sentAt: now,
        expiresAt: new Date(now.getTime() + survey.answerWindowHours * 60 * 60 * 1000),
        // Even with no closing message to send, this is how long a "obrigado" from the customer still counts as part of the wait.
        closingDueAt: new Date(now.getTime() + waitMinutes * 60 * 1000),
        ...(closingMessage && { closingText: closingMessage.text, closingSenderId: closingMessage.senderId, closingSenderName: closingMessage.senderDisplayName }),
      },
    });
    await sendSurveyText({ id: conversationId, whatsappConnectionId: conversation.whatsappConnectionId! }, conversation.contact.phone!, survey.question);
  } catch (err) {
    logger.error({ err, conversationId }, "failed to send closing follow-up");
  }
}

// What happened to a survey's closing message — SENDING is only the moment between claiming it and finishing.
const CLOSING_SENDING = "SENDING";
const CLOSING_SENT = "SENT";
const CLOSING_FAILED = "FAILED";
const CLOSING_CANCELED_CUSTOMER_WROTE = "CANCELED_CUSTOMER_WROTE";
const CLOSING_CANCELED_NEWER_CONVERSATION = "CANCELED_NEWER_CONVERSATION";
const CLOSING_CANCELED_NOT_CLOSED = "CANCELED_NOT_CLOSED";

/**
 * Sends the closing message kept on this survey, once, if it is due and still fits.
 * It is claimed first (an atomic update), so two sweeps — or two API instances —
 * never both send it; then it is dropped if the conversation is no longer closed
 * or the customer already has a newer one. Returns what became of it, or null when
 * it was not this call's to send.
 */
async function deliverClosingMessage(surveyId: string, now: Date): Promise<string | null> {
  const claimed = await prisma.satisfactionSurvey.updateMany({
    where: { id: surveyId, closingText: { not: null }, closingResolvedAt: null, closingDueAt: { lte: now } },
    data: { closingResolvedAt: now, closingOutcome: CLOSING_SENDING },
  });
  if (claimed.count === 0) return null;

  const finish = async (outcome: string) => {
    await prisma.satisfactionSurvey.update({ where: { id: surveyId }, data: { closingOutcome: outcome } });
    return outcome;
  };

  try {
    const survey = await prisma.satisfactionSurvey.findUniqueOrThrow({
      where: { id: surveyId },
      select: {
        contactId: true,
        sentAt: true,
        closingText: true,
        closingSenderId: true,
        closingSenderName: true,
        conversation: { select: { id: true, status: true, whatsappConnectionId: true, assignedAgentId: true, contact: { select: { phone: true } } } },
      },
    });
    const { conversation } = survey;
    if (conversation.status !== "CLOSED") return await finish(CLOSING_CANCELED_NOT_CLOSED);
    if (await hasConversationSince(survey.contactId, survey.sentAt)) return await finish(CLOSING_CANCELED_NEWER_CONVERSATION);
    if (!survey.closingText || !conversation.whatsappConnectionId || !conversation.contact.phone) return await finish(CLOSING_FAILED);

    // The agent may have been removed since the conversation was closed — the message still goes out, just without their name on the row.
    const sender = survey.closingSenderId ? await prisma.user.findUnique({ where: { id: survey.closingSenderId }, select: { id: true } }) : null;
    const message = await createSystemOutboundMessage({ conversationId: conversation.id, type: "TEXT", body: survey.closingText, agentId: sender?.id, allowClosed: true });
    const sent = await whatsappService.sendOutboundText(
      conversation.whatsappConnectionId,
      message.id,
      conversation.contact.phone,
      survey.closingText,
      survey.closingSenderName ?? "Atendimento"
    );
    realtimeEvents.newMessage(conversation.id, conversation.assignedAgentId);
    return await finish(sent?.status === "FAILED" ? CLOSING_FAILED : CLOSING_SENT);
  } catch (err) {
    logger.error({ err, surveyId }, "failed to send the closing message");
    await finish(CLOSING_FAILED).catch(() => undefined);
    return CLOSING_FAILED;
  }
}

/**
 * Sends every closing message whose wait is over. Run every few seconds by the server; returns how many went out.
 * A connection that is not up (right after a restart, or while it is being re-linked) is left for the next round
 * rather than failing the message for good.
 */
export async function processDueClosingMessages(now = new Date()): Promise<number> {
  const due = await prisma.satisfactionSurvey.findMany({
    where: { closingText: { not: null }, closingResolvedAt: null, closingDueAt: { lte: now }, whatsappConnection: { status: "CONNECTED" } },
    select: { id: true },
    orderBy: { closingDueAt: "asc" },
    take: 50,
  });
  let sent = 0;
  for (const { id } of due) {
    if ((await deliverClosingMessage(id, now)) === CLOSING_SENT) sent += 1;
  }
  return sent;
}

/** The customer's message is part of the survey exchange: it stays on the closed conversation, no new one opens. */
async function keepOnClosedConversation(conversationId: string, message: { body: string | null; providerMessageId: string }): Promise<void> {
  // skipDuplicates: the same WhatsApp message delivered twice is already stored.
  const { count } = await prisma.message.createMany({
    data: [{ conversationId, direction: "INBOUND", type: "TEXT", status: "DELIVERED", body: message.body, providerMessageId: message.providerMessageId }],
    skipDuplicates: true,
  });
  if (count > 0) realtimeEvents.newMessage(conversationId, null);
}

/**
 * Inbound hook for a customer who has a survey in progress on this connection.
 * Returns true when the message belongs to the survey exchange (it is stored on
 * the closed conversation and no new conversation opens), false when it should
 * follow the normal path.
 *
 *  - A 0–10 score is recorded; the thanks goes out at once and the held closing
 *    message 10 seconds later.
 *  - While the survey waits (for the score, or for the closing message), a plain
 *    "obrigado" is kept and changes nothing — the deadline stays where it was.
 *  - Anything else means the customer wants to talk: the survey ends, the held
 *    closing message is dropped, and the message opens a new conversation.
 *
 * `body` is the text of a text message — null for anything else (a picture, an
 * audio...), which is never a score or a thank-you.
 */
export async function captureSurveyAnswer(
  connectionId: string,
  contact: { id: string; phone: string | null },
  message: { body: string | null; providerMessageId: string }
): Promise<boolean> {
  const now = new Date();
  // questionId is null only on surveys from the old 1–5 scale, which no longer take answers.
  const survey = await prisma.satisfactionSurvey.findFirst({
    where: {
      contactId: contact.id,
      whatsappConnectionId: connectionId,
      questionId: { not: null },
      OR: [
        { answeredAt: null, expiresAt: { gt: now } }, // still taking the score
        { closingText: { not: null }, closingResolvedAt: null }, // the closing message is still on its way
      ],
    },
    orderBy: { sentAt: "desc" },
    include: { conversation: { select: { status: true } }, config: { select: { thanks: true } } },
  });
  if (!survey) return false;
  // The time to answer ran out while the closing message was still waiting (the server was down for a day): the survey is over.
  if (survey.answeredAt === null && survey.expiresAt <= now) return false;
  // Someone already started a newer conversation with this customer — that one owns the chat now. The same goes for
  // a conversation that was taken up again: an agent is on it, and the message has to reach them.
  if (survey.conversation.status !== "CLOSED" || (await hasConversationSince(contact.id, survey.sentAt))) return false;

  const closingPending = survey.closingText !== null && survey.closingResolvedAt === null;
  const score = parseSurveyScore(message.body);

  if (score !== null && survey.answeredAt === null) {
    const recorded = await prisma.satisfactionSurvey.updateMany({ where: { id: survey.id, answeredAt: null }, data: { score, answeredAt: now } });
    if (recorded.count === 0) {
      // The same answer arrived twice at once — the other one did the work.
      await keepOnClosedConversation(survey.conversationId, message);
      return true;
    }
    if (closingPending) {
      // Now the wait is short: the closing message follows the score by 10 seconds (unless it was claimed this very moment).
      await prisma.satisfactionSurvey.updateMany({
        where: { id: survey.id, closingText: { not: null }, closingResolvedAt: null },
        data: { closingDueAt: new Date(now.getTime() + CLOSING_AFTER_ANSWER_MS) },
      });
    }
    await keepOnClosedConversation(survey.conversationId, message);
    const thanks = survey.config?.thanks ?? DEFAULT_THANKS;
    if (contact.phone) await sendSurveyText({ id: survey.conversationId, whatsappConnectionId: connectionId }, contact.phone, thanks);
    return true;
  }

  // Still inside the wait: for the score (before it comes) or for the closing message (after it).
  const waiting = closingPending || (survey.answeredAt === null && survey.closingDueAt !== null && survey.closingDueAt > now);
  // A repeated score ("10" again) counts as the answer it already is, like a plain "obrigado".
  if (waiting && (score !== null || isGratitudeMessage(message.body))) {
    await keepOnClosedConversation(survey.conversationId, message);
    return true;
  }

  // The customer wants to talk: the survey is over and the closing message, if one was waiting, is not sent.
  if (survey.answeredAt === null) await prisma.satisfactionSurvey.updateMany({ where: { id: survey.id, answeredAt: null }, data: { expiresAt: now } });
  if (closingPending) {
    await prisma.satisfactionSurvey.updateMany({
      where: { id: survey.id, closingResolvedAt: null },
      data: { closingResolvedAt: now, closingOutcome: CLOSING_CANCELED_CUSTOMER_WROTE },
    });
  }
  return false;
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
  const [grouped, activeSurveys] = await Promise.all([
    prisma.satisfactionSurvey.groupBy({ by: ["questionId", "score"], where, _count: { _all: true } }),
    prisma.satisfactionSurveyConfig.findMany({ where: { active: true }, select: { question: true } }),
  ]);
  // "Em uso": a question of a survey that is switched on.
  const questionsInUse = new Set(activeSurveys.map((s) => s.question));

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
  const summaries = questions.map((q) => summarizeQuestion({ questionId: q.id, question: q.text, current: questionsInUse.has(q.text) }, rowsByQuestion.get(q.id) ?? []));
  // The questions in use first, then the older ones (newest first, as fetched).
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
