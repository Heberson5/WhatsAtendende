import type { FlowNode, FlowEdge } from "@prisma/client";
import { FLOW_HOURS_CLOSED, FLOW_HOURS_OPEN, renderFlowMenuText, type FlowBusinessHoursData, type FlowMenuOption } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { resolveLocalNow } from "../../lib/access-schedule";
import { realtimeEvents } from "../../realtime/realtime";
import { createNotification } from "../notifications/notifications.service";
import { toNotificationDTO } from "../notifications/notifications.mapper";
import * as whatsappService from "../whatsapp/whatsapp.service";

/**
 * Fluxo execution engine. A new conversation on a connection with an active
 * flow opens in IN_FLOW (see findOrOpenConversationForInboundMessage) and
 * every customer message while it stays there comes through here, until a
 * TRANSFER_TO_AGENT hands it to the queue/an agent or an END closes it.
 * Nothing runs unless an admin switched a flow on for that connection.
 */

// Wrong answers to the same menu before giving up and handing the customer to a person.
const MAX_INVALID_MENU_ANSWERS = 3;
// Guards against a graph that loops back on itself without a menu in between.
const MAX_STEPS_PER_RUN = 50;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Graph = { nodes: Map<string, FlowNode>; edges: FlowEdge[] };

type FlowConversation = {
  id: string;
  whatsappConnectionId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
};

async function loadGraph(flowId: string): Promise<Graph> {
  const [nodes, edges] = await Promise.all([prisma.flowNode.findMany({ where: { flowId } }), prisma.flowEdge.findMany({ where: { flowId } })]);
  return { nodes: new Map(nodes.map((n) => [n.id, n])), edges };
}

function nextNodeId(graph: Graph, nodeId: string, handle: string | null): string | null {
  return graph.edges.find((e) => e.sourceNodeId === nodeId && (e.sourceHandle ?? null) === handle)?.targetNodeId ?? null;
}

function render(text: string, conversation: FlowConversation): string {
  return text.replace(/\{\{\s*cliente\s*\}\}/gi, conversation.contactName);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** "2", "2.", "opção 2" or the option's own name all pick the second option. */
export function matchMenuOption(options: FlowMenuOption[], answer: string | null): FlowMenuOption | null {
  if (!answer) return null;
  const number = /^\D*(\d{1,2})\D*$/.exec(answer.trim());
  if (number) return options[Number(number[1]) - 1] ?? null;
  const wanted = normalize(answer);
  return options.find((o) => normalize(o.label) === wanted) ?? null;
}

export function isWithinBusinessHours(data: FlowBusinessHoursData, now: Date): boolean {
  const local = resolveLocalNow(now, data.tzOffsetMinutes);
  if (!data.days.includes(WEEKDAYS.indexOf(local.weekday))) return false;
  const [sh, sm] = data.start.split(":").map(Number);
  const [eh, em] = data.end.split(":").map(Number);
  return local.minutesOfDay >= sh * 60 + sm && local.minutesOfDay < eh * 60 + em;
}

async function sendBotText(conversation: FlowConversation, text: string): Promise<void> {
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", type: "TEXT", status: "PENDING", body: text, automatedBy: "FLOW" },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), lastMessageDirection: "OUTBOUND" } });
  await whatsappService.sendAutomatedText(conversation.whatsappConnectionId, message.id, conversation.contactPhone, text);
  realtimeEvents.newMessage(conversation.id, null);
}

async function completeSession(sessionId: string): Promise<void> {
  await prisma.flowSession.update({ where: { id: sessionId }, data: { completedAt: new Date(), currentNodeId: null } });
}

/** Ends the flow by putting the conversation in the queue, exactly like a normal new conversation. */
async function handToQueue(conversation: FlowConversation, sessionId: string | null, reason: string): Promise<void> {
  await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "NEW", enteredQueueAt: new Date() } });
  await prisma.conversationEvent.create({ data: { conversationId: conversation.id, type: "FLOW_TO_QUEUE", payload: { reason } } });
  if (sessionId) await completeSession(sessionId);
  realtimeEvents.newQueueConversation(conversation.whatsappConnectionId, conversation.id, conversation.contactName);
}

/** TRANSFER_TO_AGENT: "selected" goes straight to the least busy selected agent who is online; otherwise (or nobody online) to the queue. */
async function transfer(conversation: FlowConversation, sessionId: string, data: { assignedAgentIds?: string[]; mode?: "any" | "selected" }): Promise<void> {
  const candidateIds = data.mode === "selected" ? (data.assignedAgentIds ?? []) : [];
  if (candidateIds.length > 0) {
    const online = await prisma.user.findMany({
      where: { id: { in: candidateIds }, status: "ACTIVE", presence: "ONLINE" },
      select: { id: true, _count: { select: { assignedConversations: { where: { status: { in: ["IN_PROGRESS", "TRANSFERRED"] } } } } } },
    });
    const agent = online.sort((a, b) => a._count.assignedConversations - b._count.assignedConversations)[0];
    if (agent) {
      const now = new Date();
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "IN_PROGRESS", assignedAgentId: agent.id, enteredQueueAt: now, acceptedAt: now, assignedAgentReadAt: null },
      });
      await prisma.$transaction([
        prisma.conversationAssignment.create({ data: { conversationId: conversation.id, toAgentId: agent.id, reason: "FLOW" } }),
        prisma.conversationEvent.create({ data: { conversationId: conversation.id, type: "FLOW_ASSIGNED", payload: { toAgentId: agent.id } } }),
      ]);
      await completeSession(sessionId);
      realtimeEvents.conversationAccepted(conversation.id, conversation.whatsappConnectionId, agent.id);
      const notification = await createNotification({
        userId: agent.id,
        type: "MESSAGE",
        title: conversation.contactName,
        body: "Nova conversa encaminhada pelo fluxo",
        entityType: "Conversation",
        entityId: conversation.id,
      });
      realtimeEvents.notificationCreated(agent.id, toNotificationDTO(notification));
      return;
    }
  }
  await handToQueue(conversation, sessionId, "TRANSFER");
}

async function closeByFlow(conversation: FlowConversation, sessionId: string): Promise<void> {
  await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await prisma.conversationEvent.create({ data: { conversationId: conversation.id, type: "CLOSED", payload: { byFlow: true } } });
  await completeSession(sessionId);
  realtimeEvents.newMessage(conversation.id, null);
}

/** Walks the graph from `nodeId` until it reaches a menu (waits for the customer) or the flow ends. */
async function advance(conversation: FlowConversation, sessionId: string, graph: Graph, startNodeId: string | null): Promise<void> {
  let nodeId = startNodeId;
  for (let step = 0; nodeId && step < MAX_STEPS_PER_RUN; step++) {
    const node = graph.nodes.get(nodeId);
    if (!node) break;
    const data = (node.data ?? {}) as Record<string, unknown>;
    switch (node.type) {
      case "START":
        nodeId = nextNodeId(graph, node.id, null);
        break;
      case "TEXT_MESSAGE":
        await sendBotText(conversation, render(String(data.text ?? ""), conversation));
        nodeId = nextNodeId(graph, node.id, null);
        break;
      case "BUSINESS_HOURS":
        nodeId = nextNodeId(graph, node.id, isWithinBusinessHours(data as unknown as FlowBusinessHoursData, new Date()) ? FLOW_HOURS_OPEN : FLOW_HOURS_CLOSED);
        break;
      case "MENU":
        await sendBotText(conversation, render(renderFlowMenuText(data as unknown as { prompt?: string; options: FlowMenuOption[] }), conversation));
        await prisma.flowSession.update({ where: { id: sessionId }, data: { currentNodeId: node.id, invalidAttempts: 0 } });
        return;
      case "TRANSFER_TO_AGENT":
        await transfer(conversation, sessionId, data as { assignedAgentIds?: string[]; mode?: "any" | "selected" });
        return;
      case "END":
        await closeByFlow(conversation, sessionId);
        return;
    }
  }
  // A path that just stops (or a broken/looping graph) never strands the customer.
  await handToQueue(conversation, sessionId, "DEAD_END");
}

async function run(conversationId: string, flowId: string | null, answer: string | null): Promise<void> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, status: true, whatsappConnectionId: true, contactId: true, contact: { select: { name: true, phone: true } } },
  });
  if (!row || row.status !== "IN_FLOW" || !row.whatsappConnectionId || !row.contact.phone) return;
  const conversation: FlowConversation = {
    id: row.id,
    whatsappConnectionId: row.whatsappConnectionId,
    contactId: row.contactId,
    contactName: row.contact.name ?? row.contact.phone,
    contactPhone: row.contact.phone,
  };

  const session = await prisma.flowSession.findUnique({ where: { conversationId } });
  if (!session) {
    if (!flowId) return handToQueue(conversation, null, "NO_SESSION");
    const created = await prisma.flowSession.create({ data: { flowId, contactId: conversation.contactId, conversationId } });
    const graph = await loadGraph(flowId);
    const start = [...graph.nodes.values()].find((n) => n.type === "START");
    return advance(conversation, created.id, graph, start ? nextNodeId(graph, start.id, null) : null);
  }

  const graph = await loadGraph(session.flowId);
  const menu = session.currentNodeId ? graph.nodes.get(session.currentNodeId) : undefined;
  // The flow was re-saved/deleted while this customer was mid-menu — hand them to a person.
  if (!menu || menu.type !== "MENU") return handToQueue(conversation, session.id, "STALE_SESSION");

  const menuData = (menu.data ?? {}) as unknown as { prompt?: string; options: FlowMenuOption[] };
  const option = matchMenuOption(menuData.options ?? [], answer);
  if (option) return advance(conversation, session.id, graph, nextNodeId(graph, menu.id, option.id));

  const attempts = session.invalidAttempts + 1;
  if (attempts >= MAX_INVALID_MENU_ANSWERS) {
    await sendBotText(conversation, "Não consegui entender sua resposta. Vou encaminhar você para um atendente.");
    return handToQueue(conversation, session.id, "INVALID_ANSWERS");
  }
  await prisma.flowSession.update({ where: { id: session.id }, data: { invalidAttempts: attempts } });
  await sendBotText(conversation, `Não entendi. ${render(renderFlowMenuText(menuData), conversation)}`);
}

// Two messages from the same customer arriving together must not run the flow twice in parallel.
const queues = new Map<string, Promise<void>>();

/** Entry point from the inbound-message handler for a conversation in IN_FLOW. `flowId` is set only for the message that opened it. */
export function handleInboundForFlow(conversationId: string, flowId: string | null, answer: string | null): Promise<void> {
  const previous = queues.get(conversationId) ?? Promise.resolve();
  const next = previous
    .then(() => run(conversationId, flowId, answer))
    .catch((err) => logger.error({ err, conversationId }, "flow engine failed"));
  queues.set(conversationId, next);
  void next.finally(() => {
    if (queues.get(conversationId) === next) queues.delete(conversationId);
  });
  return next;
}

/** Called when a person takes a conversation out of IN_FLOW (Gestão, the phone...) so its session doesn't linger. */
export async function endFlowSession(conversationId: string): Promise<void> {
  await prisma.flowSession.updateMany({ where: { conversationId, completedAt: null }, data: { completedAt: new Date(), currentNodeId: null } });
}
