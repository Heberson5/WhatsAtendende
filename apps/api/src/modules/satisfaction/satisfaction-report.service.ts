import type { SatisfactionCategory, SatisfactionReportDTO, SatisfactionResponseDTO, SatisfactionScoreStatsDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { calculateNps } from "./satisfaction.service";

/**
 * Relatórios › Pesquisa de satisfação: the 0–10 (NPS) surveys sent in the
 * period — who rated what, each attendant's and each connection's numbers,
 * how it moved over the period, and every answer with its conversation. See
 * PROMPT: "relatório somente das pesquisas, podendo saber de qual cliente foi
 * a nota e poder olhar a conversa avaliada, poder saber as notas que cada
 * atendente recebe". Surveys of the old 1–5 scale are left out: they don't
 * add up with NPS.
 */

export interface SatisfactionReportParams {
  from: Date;
  to: Date;
  agentId?: string;
  connectionIds?: string[];
  /** The browser's UTC offset (Date#getTimezoneOffset) — days of the trend are the viewer's days. */
  tzOffsetMinutes?: number;
}

const MAX_RESPONSES = 5000;
const DAY_MS = 86_400_000;

export function categoryOf(score: number): SatisfactionCategory {
  return score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
}

export const CATEGORY_LABEL: Record<SatisfactionCategory, string> = { promoter: "Promotor", passive: "Neutro", detractor: "Detrator" };

function stats(sent: number, scores: number[]): SatisfactionScoreStatsDTO {
  const distribution = Array<number>(11).fill(0);
  for (const s of scores) distribution[s] += 1;
  const nps = calculateNps(distribution);
  const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  return {
    sent,
    answered: scores.length,
    responseRate: sent ? Math.round((scores.length / sent) * 100) : null,
    average,
    nps: nps.nps,
    promoters: nps.promoters,
    passives: nps.passives,
    detractors: nps.detractors,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

export async function getSatisfactionReport(params: SatisfactionReportParams): Promise<SatisfactionReportDTO> {
  const now = new Date();
  const rows = await prisma.satisfactionSurvey.findMany({
    where: {
      sentAt: { gte: params.from, lte: params.to },
      questionId: { not: null },
      ...(params.agentId && { agentId: params.agentId }),
      ...(params.connectionIds && { whatsappConnectionId: { in: params.connectionIds } }),
    },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      conversationId: true,
      sentAt: true,
      answeredAt: true,
      expiresAt: true,
      score: true,
      agentId: true,
      agent: { select: { displayName: true } },
      whatsappConnection: { select: { id: true, name: true, color: true } },
      question: { select: { text: true } },
      config: { select: { name: true } },
      conversation: { select: { contact: { select: { name: true, phone: true } } } },
    },
  });

  const answeredScores = rows.filter((r) => r.score !== null).map((r) => r.score!);
  const distribution = Array<number>(11).fill(0);
  for (const s of answeredScores) distribution[s] += 1;

  // Per attendant / per connection.
  const byAgent = new Map<string, { agentId: string | null; agentName: string; sent: number; scores: number[] }>();
  const byConnection = new Map<string, { connectionId: string; connectionName: string; connectionColor: string; sent: number; scores: number[] }>();
  for (const r of rows) {
    const agentKey = r.agentId ?? "none";
    const agent = byAgent.get(agentKey) ?? { agentId: r.agentId, agentName: r.agent?.displayName ?? "Sem atendente", sent: 0, scores: [] };
    agent.sent += 1;
    if (r.score !== null) agent.scores.push(r.score);
    byAgent.set(agentKey, agent);
    const conn = byConnection.get(r.whatsappConnection.id) ?? {
      connectionId: r.whatsappConnection.id,
      connectionName: r.whatsappConnection.name,
      connectionColor: r.whatsappConnection.color,
      sent: 0,
      scores: [],
    };
    conn.sent += 1;
    if (r.score !== null) conn.scores.push(r.score);
    byConnection.set(r.whatsappConnection.id, conn);
  }

  // The trend: the viewer's days, or weeks (from Monday) when the period is longer than a month.
  const offsetMs = (params.tzOffsetMinutes ?? 0) * 60_000;
  const weekly = params.to.getTime() - params.from.getTime() > 31 * DAY_MS;
  const bucketOf = (d: Date) => {
    const local = new Date(d.getTime() - offsetMs);
    local.setUTCHours(0, 0, 0, 0);
    if (weekly) local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
    return local.getTime();
  };
  const buckets = new Map<number, number[]>();
  for (const r of rows) {
    if (r.score === null || !r.answeredAt) continue;
    const key = bucketOf(r.answeredAt);
    buckets.set(key, [...(buckets.get(key) ?? []), r.score]);
  }
  const trend = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, scores]) => {
      const d = new Date(start);
      const s = stats(scores.length, scores);
      return {
        start: new Date(start + offsetMs).toISOString(),
        label: `${weekly ? "Semana de " : ""}${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`,
        answered: s.answered,
        average: s.average,
        nps: s.nps,
      };
    });

  const responses: SatisfactionResponseDTO[] = rows.slice(0, MAX_RESPONSES).map((r) => ({
    surveyId: r.id,
    conversationId: r.conversationId,
    sentAt: r.sentAt.toISOString(),
    answeredAt: r.answeredAt?.toISOString() ?? null,
    contactName: r.conversation.contact.name,
    contactPhone: r.conversation.contact.phone,
    agentName: r.agent?.displayName ?? null,
    connectionName: r.whatsappConnection.name,
    surveyName: r.config?.name ?? null,
    question: r.question?.text ?? null,
    score: r.score,
    category: r.score === null ? null : categoryOf(r.score),
    status: r.score !== null ? "answered" : r.expiresAt > now ? "awaiting" : "expired",
  }));

  const sortByNps = <T extends SatisfactionScoreStatsDTO>(a: T, b: T) =>
    (b.nps ?? -Infinity) - (a.nps ?? -Infinity) || (b.average ?? -1) - (a.average ?? -1) || b.answered - a.answered;

  return {
    totals: { ...stats(rows.length, answeredScores), distribution, awaiting: responses.filter((r) => r.status === "awaiting").length },
    byAgent: [...byAgent.values()]
      .map((a) => ({
        ...stats(a.sent, a.scores),
        agentId: a.agentId,
        agentName: a.agentName,
        lowest: a.scores.length ? Math.min(...a.scores) : null,
        highest: a.scores.length ? Math.max(...a.scores) : null,
      }))
      .sort(sortByNps),
    byConnection: [...byConnection.values()].map((c) => ({ ...stats(c.sent, c.scores), connectionId: c.connectionId, connectionName: c.connectionName, connectionColor: c.connectionColor })).sort(sortByNps),
    trend,
    responses,
  };
}

/** Local date/time as dd/mm/aaaa hh:mm for exports — the viewer's clock, not the server's. */
function formatLocal(iso: string | null, tzOffsetMinutes: number): string {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

const STATUS_LABEL: Record<SatisfactionResponseDTO["status"], string> = { answered: "Respondida", awaiting: "Aguardando", expired: "Sem resposta" };

/** Rows for the CSV / Excel / PDF export of the answers. */
export function responsesToRows(report: SatisfactionReportDTO, tzOffsetMinutes: number): Record<string, unknown>[] {
  return report.responses.map((r) => ({
    "Enviada em": formatLocal(r.sentAt, tzOffsetMinutes),
    "Respondida em": formatLocal(r.answeredAt, tzOffsetMinutes),
    Cliente: r.contactName ?? "-",
    Telefone: r.contactPhone ?? "-",
    Atendente: r.agentName ?? "-",
    Conexão: r.connectionName,
    Pesquisa: r.surveyName ?? "-",
    Nota: r.score ?? "-",
    Classificação: r.category ? CATEGORY_LABEL[r.category] : STATUS_LABEL[r.status],
  }));
}

/** Rows for the export of each attendant's numbers. */
export function agentsToRows(report: SatisfactionReportDTO): Record<string, unknown>[] {
  return report.byAgent.map((a) => ({
    Atendente: a.agentName,
    "Pesquisas enviadas": a.sent,
    Respostas: a.answered,
    "Taxa de resposta (%)": a.responseRate ?? "-",
    "Nota média": a.average ?? "-",
    "NPS (-100 a 100)": a.nps ?? "-",
    Promotores: a.promoters,
    Neutros: a.passives,
    Detratores: a.detractors,
    "Menor nota": a.lowest ?? "-",
    "Maior nota": a.highest ?? "-",
  }));
}
