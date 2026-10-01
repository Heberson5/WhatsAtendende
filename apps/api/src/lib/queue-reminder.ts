import { prisma } from "./prisma";
import { getBusinessSettings } from "../modules/settings/settings.service";
import { realtimeEvents } from "../realtime/realtime";

const REMINDER_CADENCE_KEY = "queueReminderLastSentAt";

/**
 * Gate for server.ts's once-a-minute timer — the admin-configured
 * queueReminderIntervalMinutes (default 1) decides how often this actually
 * fires, independent of how often the outer setInterval ticks. Same
 * cadence-marker pattern as holidays.service.ts's runHolidaySyncIfDue.
 * See PROMPT: "notificações a cada um minuto quando tem conversas na
 * fila... parametrizado quanto tempo deverá ser notificado".
 */
export async function sendQueueRemindersIfDue(): Promise<void> {
  const { queueReminderIntervalMinutes } = await getBusinessSettings();
  const intervalMs = (Number(queueReminderIntervalMinutes) || 1) * 60_000;

  const marker = await prisma.systemSetting.findUnique({ where: { key: REMINDER_CADENCE_KEY } });
  const lastSentAt = marker ? new Date((marker.value as { at: string }).at) : null;
  const dueAt = lastSentAt ? new Date(lastSentAt.getTime() + intervalMs) : new Date(0);
  if (new Date() < dueAt) return;

  // Scoped to WhatsApp only — Meta (Instagram/Messenger) channels have no
  // per-connection agent assignment on User to notify against. See PROMPT's
  // plan artifact, "Resumo do escopo".
  const waiting = await prisma.conversation.groupBy({
    by: ["whatsappConnectionId"],
    where: { status: { in: ["NEW", "WAITING"] }, channel: "WHATSAPP", whatsappConnectionId: { not: null } },
    _count: true,
  });
  // Nothing waiting — leave the marker untouched so a conversation arriving
  // a second later reminds right away instead of waiting out this cycle.
  if (waiting.length === 0) return;

  const connections = await prisma.whatsAppConnection.findMany({
    where: { id: { in: waiting.map((w) => w.whatsappConnectionId!) } },
    select: { id: true, name: true },
  });
  const connectionNames = new Map(connections.map((c) => [c.id, c.name]));

  for (const { whatsappConnectionId, _count } of waiting) {
    const connectionId = whatsappConnectionId!;
    const connectionName = connectionNames.get(connectionId) ?? connectionId;
    // Only genuinely ONLINE agents — AWAY (any pause reason) and OFFLINE are
    // both excluded. See PROMPT: "para os atendentes que estão com pausa,
    // não deverão ser notificados, independente da pausa. Só deverão ser
    // notificados os que realmente estiverem online."
    const agents = await prisma.user.findMany({
      where: { role: "AGENT", status: "ACTIVE", presence: "ONLINE", whatsappConnectionId: connectionId },
      select: { id: true },
    });
    for (const agent of agents) {
      realtimeEvents.queueReminder(agent.id, connectionId, connectionName, _count);
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: REMINDER_CADENCE_KEY },
    update: { value: { at: new Date().toISOString() } },
    create: { key: REMINDER_CADENCE_KEY, value: { at: new Date().toISOString() } },
  });
}
