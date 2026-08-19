import { prisma } from "../../lib/prisma";

export interface ReportParams {
  from: Date;
  to: Date;
  agentId?: string;
}

function minutes(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 60000);
}

export async function getAttendanceReport({ from, to, agentId }: ReportParams) {
  const conversations = await prisma.conversation.findMany({
    where: { createdAt: { gte: from, lte: to }, assignedAgentId: agentId },
    include: {
      contact: true,
      assignedAgent: true,
      messages: { select: { direction: true } },
      transfers: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return conversations.map((c) => {
    const received = c.messages.filter((m) => m.direction === "INBOUND").length;
    const sent = c.messages.filter((m) => m.direction === "OUTBOUND").length;
    const acceptMs = c.acceptedAt ? c.acceptedAt.getTime() - c.enteredQueueAt.getTime() : null;
    const firstResponseMs = c.acceptedAt && c.firstResponseAt ? c.firstResponseAt.getTime() - c.acceptedAt.getTime() : null;
    const totalMs = c.closedAt ? c.closedAt.getTime() - c.enteredQueueAt.getTime() : null;

    return {
      date: c.createdAt.toISOString(),
      clientName: c.contact.name ?? c.contact.phone,
      phone: c.contact.phone,
      agentName: c.assignedAgent?.displayName ?? "-",
      enteredQueueAt: c.enteredQueueAt.toISOString(),
      acceptedAt: c.acceptedAt ? c.acceptedAt.toISOString() : null,
      acceptMinutes: minutes(acceptMs),
      firstResponseMinutes: minutes(firstResponseMs),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      totalMinutes: minutes(totalMs),
      messagesReceived: received,
      messagesSent: sent,
      transfersCount: c.transfers.length,
      status: c.status,
    };
  });
}

export async function getPerAgentReport({ from, to }: ReportParams) {
  const agents = await prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { displayName: "asc" } });

  return Promise.all(
    agents.map(async (agent) => {
      const conversations = await prisma.conversation.findMany({
        where: { assignedAgentId: agent.id, createdAt: { gte: from, lte: to } },
      });
      const messagesSent = await prisma.message.count({ where: { senderAgentId: agent.id, createdAt: { gte: from, lte: to } } });
      const transfersReceived = await prisma.conversationTransfer.count({ where: { toAgentId: agent.id, createdAt: { gte: from, lte: to } } });
      const transfersMade = await prisma.conversationTransfer.count({ where: { fromAgentId: agent.id, createdAt: { gte: from, lte: to } } });

      const acceptDiffs = conversations.filter((c) => c.acceptedAt).map((c) => c.acceptedAt!.getTime() - c.enteredQueueAt.getTime());
      const firstResponseDiffs = conversations
        .filter((c) => c.acceptedAt && c.firstResponseAt)
        .map((c) => c.firstResponseAt!.getTime() - c.acceptedAt!.getTime());
      const handlingDiffs = conversations.filter((c) => c.acceptedAt && c.closedAt).map((c) => c.closedAt!.getTime() - c.acceptedAt!.getTime());

      const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 60000) : null);

      return {
        agentName: agent.displayName,
        conversations: conversations.length,
        messagesSent,
        avgAcceptMinutes: avg(acceptDiffs),
        avgFirstResponseMinutes: avg(firstResponseDiffs),
        avgHandlingMinutes: avg(handlingDiffs),
        transfersReceived,
        transfersMade,
      };
    })
  );
}

export async function getMessagesReport({ from, to, agentId }: ReportParams) {
  const [received, sent] = await Promise.all([
    prisma.message.count({ where: { direction: "INBOUND", createdAt: { gte: from, lte: to }, conversation: { assignedAgentId: agentId } } }),
    prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: from, lte: to }, conversation: { assignedAgentId: agentId } } }),
  ]);
  return { received, sent, total: received + sent };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
}
