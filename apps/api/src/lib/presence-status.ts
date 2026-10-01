import type { AgentPresence } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Closes whatever AgentStatusLog row is currently open for this user (if
 * any — `endedAt: null` means "still ongoing") and opens a new one for
 * `status`. The single place that keeps this history consistent, called
 * from presence-tracker.ts (socket connect/disconnect → ONLINE/OFFLINE)
 * and profile.service.ts's pause/resume (→ AWAY/ONLINE). Purely additive:
 * nothing else reads or writes AgentStatusLog. Feeds the Dashboard's
 * "Presença ao longo do dia" chart. See PROMPT: "gráfico sobre os
 * horários do dia que contaram estas informações, quantos online,
 * pausado (por motivo da pausa)".
 */
export async function recordPresenceTransition(userId: string, status: AgentPresence, pauseReasonId: string | null = null): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.agentStatusLog.updateMany({ where: { userId, endedAt: null }, data: { endedAt: now } }),
    prisma.agentStatusLog.create({ data: { userId, status, pauseReasonId, startedAt: now } }),
  ]);
}
