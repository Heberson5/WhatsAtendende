import type { Channel, ConversationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { logger } from "../../lib/logger";
import { realtimeEvents } from "../../realtime/realtime";
import { createSystemOutboundMessage } from "../messages/messages.service";
import { sendOutboundTextViaChannel } from "../messages/send-via-channel";
import { getNoReturnSettings } from "../settings/settings.service";
import { getConnectionSchedule, isWorkScheduleOpen } from "../work-schedules/work-schedules.service";
import { renderAutoMessageTemplate, ROLE_LABEL } from "../auto-message-templates/auto-message-templates.service";
import { getConversationOrThrow, NO_RETURN_CLOSE_REASON } from "./conversations.service";

const OPEN_STATUSES: ConversationStatus[] = ["IN_PROGRESS", "TRANSFERRED"];

type Conversation = Awaited<ReturnType<typeof getConversationOrThrow>>;

/** Sends one of the "falta de retorno" texts in the assigned agent's name, without restarting the countdown. */
async function sendNoReturnText(conversation: Conversation, template: string) {
  const agent = conversation.assignedAgent!;
  const text = renderAutoMessageTemplate(template, {
    atendente: agent.displayName,
    atendenteNome: agent.fullName,
    atendenteCargo: ROLE_LABEL[agent.role],
    cliente: conversation.contact.name ?? conversation.contact.phone ?? "",
    primeiroNome: conversation.contact.firstName,
  });
  const message = await createSystemOutboundMessage({ conversationId: conversation.id, type: "TEXT", body: text, agentId: agent.id });
  await sendOutboundTextViaChannel(conversation, message.id, text, null);
  realtimeEvents.newMessage(conversation.id, agent.id);
}

/**
 * "Encerrar por falta de retorno": the customer gets the no-return message, no satisfaction survey follows, and the
 * close counts for the assigned agent like any other — kept apart by closeReason in the reports. `byUserId` null =
 * the automatic close.
 */
export async function closeForNoReturn(conversationId: string, byUserId: string | null) {
  const conversation = await getConversationOrThrow(conversationId);
  if (!OPEN_STATUSES.includes(conversation.status) || !conversation.assignedAgentId) throw Errors.conflict("Esta conversa não está em atendimento");
  const agentId = conversation.assignedAgentId;

  await sendNoReturnText(conversation, (await getNoReturnSettings()).closeText);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: agentId,
      closeReason: NO_RETURN_CLOSE_REASON,
      noReturnReminderAt: null,
      noReturnCloseAt: null,
      noReturnHold: false,
      pendingTransferDeadline: null,
      interventionById: null,
      interventionStartedAt: null,
    },
  });
  await prisma.conversationEvent.create({
    data: { conversationId, type: "CLOSED", payload: { agentId, previousStatus: conversation.status, reason: NO_RETURN_CLOSE_REASON, automatic: !byUserId } },
  });
  await prisma.conversationNote.create({
    data: {
      conversationId,
      authorId: byUserId,
      body: byUserId ? "Encerrada por falta de retorno do cliente" : "Encerrada automaticamente por falta de retorno do cliente",
    },
  });
  realtimeEvents.conversationClosed(conversationId, agentId);
  if (conversation.interventionById) realtimeEvents.conversationClosed(conversationId, conversation.interventionById);
  return getConversationOrThrow(conversationId);
}

/** "Aguardar cliente" / "Manter aberta": no automatic close until the customer answers (or the agent turns it off). */
export async function setNoReturnHold(conversationId: string, hold: boolean) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: hold ? { noReturnHold: true, noReturnReminderAt: null, noReturnCloseAt: null } : { noReturnHold: false },
  });
  return getConversationOrThrow(conversationId);
}

let lastTickAt: number | null = null;

/**
 * server.ts's once-a-minute sweep for the automatic mode. After the agent's last message the customer has
 * reminderMinutes to answer before the reminder goes out, then closeMinutes before the conversation closes — both
 * deadlines are pushed forward while the connection is outside its work schedule, so only expediente counts. Never
 * runs on a conversation whose last word is the customer's, with a pending "lembrar de retornar" or scheduled
 * message, or that the agent put on "Aguardar cliente".
 */
export async function processNoReturnConversations(now = new Date()): Promise<void> {
  const elapsedMs = lastTickAt === null ? 0 : Math.max(0, now.getTime() - lastTickAt);
  lastTickAt = now.getTime();
  const settings = await getNoReturnSettings();
  if (!settings.enabled) return;

  const conversations = await prisma.conversation.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      assignedAgentId: { not: null },
      interventionById: null,
      lastMessageDirection: "OUTBOUND",
      noReturnHold: false,
      contact: { isGroup: false },
      conversationReminders: { none: { firedAt: null } },
      scheduledMessages: { none: { sentAt: null, canceledAt: null, failedAt: null } },
    },
    select: { id: true, channel: true, whatsappConnectionId: true, metaConnectionId: true, lastMessageAt: true, noReturnReminderAt: true, noReturnCloseAt: true },
  });

  const openByConnection = new Map<string, boolean>();
  const isOpen = async (channel: Channel, connectionId: string) => {
    if (!openByConnection.has(connectionId)) {
      const schedule = await getConnectionSchedule(channel, connectionId);
      openByConnection.set(connectionId, !schedule || (await isWorkScheduleOpen(schedule, now)));
    }
    return openByConnection.get(connectionId)!;
  };

  for (const c of conversations) {
    try {
      let reminderAt = c.noReturnReminderAt ?? (c.noReturnCloseAt ? null : new Date(c.lastMessageAt.getTime() + settings.reminderMinutes * 60_000));
      let closeAt = c.noReturnCloseAt;
      if (!(await isOpen(c.channel, c.whatsappConnectionId ?? c.metaConnectionId!))) {
        if (reminderAt) reminderAt = new Date(reminderAt.getTime() + elapsedMs);
        if (closeAt) closeAt = new Date(closeAt.getTime() + elapsedMs);
        await prisma.conversation.update({ where: { id: c.id }, data: { noReturnReminderAt: reminderAt, noReturnCloseAt: closeAt } });
        continue;
      }
      if (closeAt) {
        if (closeAt <= now) await closeForNoReturn(c.id, null);
      } else if (reminderAt && reminderAt <= now) {
        await sendNoReturnText(await getConversationOrThrow(c.id), settings.reminderText);
        await prisma.conversation.update({
          where: { id: c.id },
          data: { noReturnReminderAt: null, noReturnCloseAt: new Date(now.getTime() + settings.closeMinutes * 60_000) },
        });
      } else if (!c.noReturnReminderAt) {
        await prisma.conversation.update({ where: { id: c.id }, data: { noReturnReminderAt: reminderAt } });
      }
    } catch (err) {
      logger.error({ err, conversationId: c.id }, "falta de retorno: failed to process conversation");
    }
  }
}

/** Test hook: the sweep remembers when it last ran to stop the clock outside expediente. */
export function resetNoReturnClock() {
  lastTickAt = null;
}
