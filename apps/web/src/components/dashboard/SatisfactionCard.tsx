import { Star } from "lucide-react";
import type { SatisfactionSummaryDTO } from "@whatsatendende/types";
import { CHART_CARD_SHADOW } from "../../lib/chart-theme";

const SCORE_LABEL = ["Muito insatisfeito", "Insatisfeito", "Neutro", "Satisfeito", "Muito satisfeito"];

/** Pesquisa de satisfação no período: média, quantas responderam e quantas notas de cada valor. */
export function SatisfactionCard({ summary, isLoading }: { summary: SatisfactionSummaryDTO | undefined; isLoading: boolean }) {
  const max = summary ? Math.max(1, ...summary.distribution) : 1;
  const responseRate = summary?.sent ? Math.round((summary.answered / summary.sent) * 100) : null;

  return (
    <div className={`flex h-full flex-col rounded-card border border-border bg-surface p-4 ${CHART_CARD_SHADOW}`}>
      <p className="mb-2 text-xs font-medium text-muted">Pesquisa de satisfação</p>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted">Carregando...</p>
      ) : !summary?.sent ? (
        <p className="py-8 text-center text-sm text-muted">Nenhuma pesquisa enviada no período. Ela pode ser ligada em Respostas › Pesquisa.</p>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <p className="text-3xl font-semibold tabular-nums">{summary.average?.toLocaleString("pt-BR", { minimumFractionDigits: 1 }) ?? "–"}</p>
            <div className="pb-1 text-xs text-muted">
              <p className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> média de 1 a 5
              </p>
              <p className="tabular-nums">
                {summary.answered} de {summary.sent} responderam{responseRate !== null && ` (${responseRate}%)`}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = summary.distribution[score - 1];
              return (
                <li key={score} className="grid grid-cols-[1.25rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs" title={SCORE_LABEL[score - 1]}>
                  <span className="font-semibold tabular-nums">{score}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-alt">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
                  </span>
                  <span className="text-end tabular-nums text-muted">{count}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
