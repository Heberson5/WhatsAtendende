import { prisma } from "../../lib/prisma";

function avgMs(diffs: number[]): number | null {
  if (diffs.length === 0) return null;
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

export interface DashboardParams {
  from: Date;
  to: Date;
  agentId?: string;
  /** Empty/undefined = every WhatsApp connection — see PROMPT: filtro podendo selecionar várias ou todas. */
  connectionIds?: string[];
}

/**
 * "Conversas unicas" (spec section 23): number of distinct contacts with at
 * least one conversation created inside the window — a contact who wrote 30
 * messages in the same conversation still counts once.
 */
export async function getDashboard({ from, to, agentId, connectionIds }: DashboardParams) {
  const connectionFilter = connectionIds === undefined ? undefined : { in: connectionIds };
  const whereBase = {
    createdAt: { gte: from, lte: to },
    ...(agentId ? { assignedAgentId: agentId } : {}),
    ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
  };

  const [conversationsInPeriod, messages, waitingCount] = await Promise.all([
    prisma.conversation.findMany({
      where: whereBase,
      select: {
        id: true,
        contactId: true,
        status: true,
        enteredQueueAt: true,
        acceptedAt: true,
        firstResponseAt: true,
        closedAt: true,
        assignedAgentId: true,
      },
    }),
    prisma.message.groupBy({
      by: ["direction"],
      where: {
        createdAt: { gte: from, lte: to },
        conversation: {
          ...(agentId ? { assignedAgentId: agentId } : {}),
          ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
        },
      },
      _count: true,
    }),
    // Unlike every other figure here, "waiting" isn't scoped by the
    // reporting period — a conversation sitting unclaimed in the queue is
    // waiting right now regardless of which day it first entered it (the
    // same reasoning as getUsersSummary's "online" count below), and it's
    // always unassigned by definition, so agentId doesn't apply either.
    // Mirrors listQueue's own filter shape exactly, in
    // conversations.service.ts, which is what "Fila" itself shows.
    prisma.conversation.count({
      where: {
        status: { in: ["NEW", "WAITING"] },
        ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
      },
    }),
  ]);

  const uniqueContacts = new Set(conversationsInPeriod.map((c) => c.contactId)).size;
  const statusCounts = conversationsInPeriod.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const acceptDiffs = conversationsInPeriod
    .filter((c) => c.acceptedAt)
    .map((c) => c.acceptedAt!.getTime() - c.enteredQueueAt.getTime());
  const firstResponseDiffs = conversationsInPeriod
    .filter((c) => c.acceptedAt && c.firstResponseAt)
    .map((c) => c.firstResponseAt!.getTime() - c.acceptedAt!.getTime());
  const handlingDiffs = conversationsInPeriod
    .filter((c) => c.acceptedAt && c.closedAt)
    .map((c) => c.closedAt!.getTime() - c.acceptedAt!.getTime());
  const closingDiffs = conversationsInPeriod
    .filter((c) => c.closedAt)
    .map((c) => c.closedAt!.getTime() - c.enteredQueueAt.getTime());

  const received = messages.find((m) => m.direction === "INBOUND")?._count ?? 0;
  const sent = messages.find((m) => m.direction === "OUTBOUND")?._count ?? 0;

  const perAgent = await getPerAgentBreakdown(from, to, connectionFilter);
  const users = await getUsersSummary();

  return {
    conversations: {
      received: conversationsInPeriod.length,
      unique: uniqueContacts,
      inProgress: (statusCounts.IN_PROGRESS ?? 0) + (statusCounts.TRANSFERRED ?? 0),
      closed: statusCounts.CLOSED ?? 0,
      waiting: waitingCount,
    },
    messages: { received, sent, total: received + sent },
    timings: {
      avgAcceptMs: avgMs(acceptDiffs),
      avgFirstResponseMs: avgMs(firstResponseDiffs),
      avgHandlingMs: avgMs(handlingDiffs),
      avgClosingMs: avgMs(closingDiffs),
    },
    perAgent,
    users,
  };
}

// A snapshot of right now, not scoped to the reporting period — "how many
// users are online" is inherently a current-moment question, not a
// historical one like the rest of this dashboard.
async function getUsersSummary() {
  const [online, active, total] = await Promise.all([
    prisma.user.count({ where: { presence: "ONLINE" } }),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count(),
  ]);
  return { online, active, total };
}

async function getPerAgentBreakdown(from: Date, to: Date, connectionFilter?: { in: string[] }) {
  const agents = await prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, displayName: true } });

  const results = await Promise.all(
    agents.map(async (agent) => {
      const conversations = await prisma.conversation.findMany({
        where: { assignedAgentId: agent.id, createdAt: { gte: from, lte: to }, ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}) },
        select: { id: true, acceptedAt: true, closedAt: true, enteredQueueAt: true },
      });
      const sentCount = await prisma.message.count({
        where: {
          senderAgentId: agent.id,
          createdAt: { gte: from, lte: to },
          ...(connectionFilter ? { conversation: { whatsappConnectionId: connectionFilter } } : {}),
        },
      });
      // Inbound messages inside this agent's own conversations — not
      // "messages sent to this agent specifically" (WhatsApp has no such
      // concept), the same scoping the rest of this breakdown already uses.
      // See PROMPT: "separe gráficos... de mensagens enviadas/recebidas por
      // atendentes".
      const receivedCount = await prisma.message.count({
        where: {
          direction: "INBOUND",
          createdAt: { gte: from, lte: to },
          conversation: { assignedAgentId: agent.id, ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}) },
        },
      });
      const handlingDiffs = conversations
        .filter((c) => c.acceptedAt && c.closedAt)
        .map((c) => c.closedAt!.getTime() - c.acceptedAt!.getTime());

      return {
        agentId: agent.id,
        agentName: agent.displayName,
        conversations: conversations.length,
        messagesSent: sentCount,
        messagesReceived: receivedCount,
        avgHandlingMs: avgMs(handlingDiffs),
      };
    })
  );

  return results.filter((r) => r.conversations > 0 || r.messagesSent > 0);
}

// Common Portuguese function words (articles, prepositions, pronouns,
// conjunctions, auxiliary verb forms, generic fillers) — excluded from the
// Dashboard's word cloud so it surfaces what customers are actually asking
// about instead of the words every sentence has anyway. Not exhaustive by
// design: a short, high-frequency list is enough to keep the cloud useful.
const WORD_CLOUD_STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "para", "pra", "pro", "por", "com", "sem", "que", "se",
  "e", "ou", "mas", "como", "mais", "menos", "muito", "muita", "muitos", "muitas",
  "já", "so", "só", "ainda", "tambem", "também", "ate", "até", "pelo", "pela", "pelos",
  "pelas", "ao", "aos", "eu", "tu", "ele", "ela", "nos", "nós", "vos", "eles",
  "elas", "me", "te", "lhe", "lhes", "meu", "minha", "meus", "minhas", "teu", "tua",
  "teus", "tuas", "seu", "sua", "seus", "suas", "nosso", "nossa", "nossos", "nossas",
  "isso", "isto", "aquilo", "este", "esta", "estes", "estas", "esse", "essa", "esses",
  "essas", "aquele", "aquela", "aqueles", "aquelas", "qual", "quais", "quando", "onde",
  "quem", "cujo", "cuja", "cujos", "cujas", "nao", "não", "sim", "foi", "ser",
  "estar", "está", "estou", "estão", "estao", "tem", "têm", "ter", "tinha",
  "vai", "vou", "vamos", "vao", "vão", "pode", "podem", "posso", "consegue", "consigo",
  "fazer", "faz", "fez", "dia", "dias", "hoje", "ontem", "amanha", "amanhã", "aqui",
  "ali", "la", "lá", "bom", "boa", "bem", "ola", "olá", "oi", "tudo", "ta", "tá", "num",
  "numa", "voce", "você", "voces", "vocês", "sr", "sra",
]);

function tokenizeForWordCloud(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ") // strip links before splitting
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !WORD_CLOUD_STOPWORDS.has(word));
}

/**
 * Top ~40 words from messages the customer sent (never the agent's own
 * replies) in the selected period — same filters as the rest of the
 * Dashboard. See PROMPT: "nuvem das palavras ou frases que os clientes mais
 * escreveram". Capped at WORD_CLOUD_MESSAGE_LIMIT messages scanned so a
 * very large date range can't turn this into an unbounded full-table scan.
 */
const WORD_CLOUD_MESSAGE_LIMIT = 20_000;
const WORD_CLOUD_TOP_N = 40;

// ---------------------------------------------------------------------------
// "Presença ao longo do dia" (Dashboard section 8): for each hour-of-day
// (0-23), how many distinct agent/day occurrences were Online vs Paused
// (broken down by pause reason) during that hour across the selected
// period. Built from AgentStatusLog, the per-transition history that feeds
// this chart (see presence-status.ts) — before that table existed, only the
// *current* presence was known, never when a change happened.
// ---------------------------------------------------------------------------

const OTHER_PAUSE_REASON_LABEL = "Outros motivos";
// Defensive cap on how many hour-cells a single log segment can touch —
// comfortably above any real shift length, just in case a row is ever left
// open for an unexpectedly long time (e.g. a crashed disconnect timer).
const MAX_HOUR_CELLS_PER_SEGMENT = 24 * 62;

/** Every local hour-of-day cell `[startUtc, endUtc)` touches, as `{dateKey, hour}` — dateKey disambiguates the same hour-of-day across different calendar days. */
function iterateHourCells(startUtc: Date, endUtc: Date, tzOffsetMinutes: number): { dateKey: string; hour: number }[] {
  const offsetMs = tzOffsetMinutes * 60_000;
  const cells: { dateKey: string; hour: number }[] = [];
  let cursor = new Date(startUtc.getTime() - offsetMs);
  const endLocal = new Date(endUtc.getTime() - offsetMs);
  let guard = 0;
  while (cursor < endLocal && guard < MAX_HOUR_CELLS_PER_SEGMENT) {
    cells.push({ dateKey: cursor.toISOString().slice(0, 10), hour: cursor.getUTCHours() });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), cursor.getUTCHours() + 1));
    guard++;
  }
  return cells;
}

export interface PresenceByHourParams {
  from: Date;
  to: Date;
  agentId?: string;
  tzOffsetMinutes: number;
}

export async function getPresenceByHour({ from, to, agentId, tzOffsetMinutes }: PresenceByHourParams) {
  const now = new Date();
  const logs = await prisma.agentStatusLog.findMany({
    where: {
      status: { in: ["ONLINE", "AWAY"] },
      startedAt: { lt: to },
      OR: [{ endedAt: null }, { endedAt: { gt: from } }],
      user: { role: "AGENT", ...(agentId ? { id: agentId } : {}) },
    },
    select: { userId: true, status: true, startedAt: true, endedAt: true, pauseReason: { select: { name: true } } },
  });

  // Dedup per (agent, calendar day, hour, bucket) — a reconnect every ~15min
  // (presence-tracker's access-token refresh) closes and reopens the ONLINE
  // log back-to-back, which would otherwise inflate the same hour's count
  // several times over for one agent who was online the whole time.
  const touched = new Set<string>();
  const countsByHour: Record<number, Record<string, number>> = {};
  for (let h = 0; h < 24; h++) countsByHour[h] = {};

  for (const log of logs) {
    const bucket = log.status === "ONLINE" ? "Online" : log.pauseReason?.name ?? OTHER_PAUSE_REASON_LABEL;
    const segStart = Math.max(log.startedAt.getTime(), from.getTime());
    const segEnd = Math.min((log.endedAt ?? now).getTime(), to.getTime(), now.getTime());
    if (segEnd <= segStart) continue;

    for (const cell of iterateHourCells(new Date(segStart), new Date(segEnd), tzOffsetMinutes)) {
      const key = `${log.userId}|${cell.dateKey}|${cell.hour}|${bucket}`;
      if (touched.has(key)) continue;
      touched.add(key);
      countsByHour[cell.hour][bucket] = (countsByHour[cell.hour][bucket] ?? 0) + 1;
    }
  }

  // "Online" always first, then every pause reason seen — by total count
  // descending so the biggest bar segments legend first, "Outros motivos"
  // (if present) always last since it's a catch-all, not a real reason.
  const reasonTotals = new Map<string, number>();
  for (const hourCounts of Object.values(countsByHour)) {
    for (const [bucket, count] of Object.entries(hourCounts)) {
      if (bucket === "Online") continue;
      reasonTotals.set(bucket, (reasonTotals.get(bucket) ?? 0) + count);
    }
  }
  const reasons = Array.from(reasonTotals.entries())
    .sort((a, b) => (a[0] === OTHER_PAUSE_REASON_LABEL ? 1 : b[0] === OTHER_PAUSE_REASON_LABEL ? -1 : b[1] - a[1]))
    .map(([name]) => name);
  const series = ["Online", ...reasons];

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, counts: countsByHour[hour] }));
  return { series, hours };
}

export async function getWordCloud({ from, to, agentId, connectionIds }: DashboardParams): Promise<{ word: string; count: number }[]> {
  const connectionFilter = connectionIds === undefined ? undefined : { in: connectionIds };
  const messages = await prisma.message.findMany({
    where: {
      direction: "INBOUND",
      body: { not: null },
      createdAt: { gte: from, lte: to },
      conversation: {
        ...(agentId ? { assignedAgentId: agentId } : {}),
        ...(connectionFilter ? { whatsappConnectionId: connectionFilter } : {}),
      },
    },
    select: { body: true },
    take: WORD_CLOUD_MESSAGE_LIMIT,
  });

  const counts = new Map<string, number>();
  for (const { body } of messages) {
    for (const word of tokenizeForWordCloud(body!)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, WORD_CLOUD_TOP_N)
    .map(([word, count]) => ({ word, count }));
}
