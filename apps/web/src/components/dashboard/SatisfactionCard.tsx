import type { SatisfactionQuestionSummaryDTO, SatisfactionSummaryDTO } from "@whatsatendende/types";
import { CHART_CARD_SHADOW } from "../../lib/chart-theme";

const formatNps = (nps: number) => (nps > 0 ? `+${nps}` : String(nps));
const formatAverage = (average: number) => average.toLocaleString("pt-BR", { minimumFractionDigits: 1 });
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function responseSummary(q: SatisfactionQuestionSummaryDTO) {
  const rate = q.sent ? ` (${percent(q.answered, q.sent)}%)` : "";
  return `${q.answered} de ${q.sent} responderam${rate}`;
}

/** Promoters / passives / detractors as one stacked bar — the counts are spelled out under it, color is never the only cue. */
function NpsBreakdown({ question }: { question: SatisfactionQuestionSummaryDTO }) {
  const { promoters, passives, detractors, answered } = question;
  const parts = [
    { label: "Promotores (9–10)", count: promoters, color: "bg-success" },
    { label: "Neutros (7–8)", count: passives, color: "bg-warning" },
    { label: "Detratores (0–6)", count: detractors, color: "bg-danger" },
  ];
  return (
    <div className="mt-3">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-surface-alt"
        role="img"
        aria-label={parts.map((p) => `${p.label}: ${p.count}`).join(", ")}
      >
        {parts.map((p) => (
          <span key={p.label} className={`block h-full ${p.color}`} style={{ width: `${percent(p.count, answered)}%` }} />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="flex items-center gap-1 text-muted">
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.color}`} aria-hidden />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="font-semibold tabular-nums">{p.count}</span>
            <span className="text-muted tabular-nums"> · {percent(p.count, answered)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionBlock({ question }: { question: SatisfactionQuestionSummaryDTO }) {
  const isNps = question.scaleMax === 10;
  return (
    <div>
      <div className="flex items-start gap-2">
        <p className="line-clamp-3 min-w-0 flex-1 break-words text-sm" title={question.question}>
          {question.question}
        </p>
        {question.current && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Atual</span>
        )}
      </div>
      <div className="mt-2 flex items-end gap-3">
        {isNps ? (
          <p className="text-3xl font-semibold tabular-nums" title="NPS = % de promotores − % de detratores">
            {question.nps === null ? "–" : formatNps(question.nps)}
          </p>
        ) : (
          <p className="text-3xl font-semibold tabular-nums">{question.average === null ? "–" : formatAverage(question.average)}</p>
        )}
        <div className="pb-1 text-xs text-muted">
          <p className="font-medium">{isNps ? "NPS" : "média de 1 a 5 · escala antiga, sem NPS"}</p>
          <p className="tabular-nums">{responseSummary(question)}</p>
          {isNps && question.average !== null && <p className="tabular-nums">média {formatAverage(question.average)} de 0 a 10</p>}
        </div>
      </div>
      {isNps && question.answered > 0 && <NpsBreakdown question={question} />}
    </div>
  );
}

/** Pesquisa de satisfação no período: o NPS da pergunta em uso e, abaixo, o das perguntas anteriores, que continuam no histórico. */
export function SatisfactionCard({ summary, isLoading }: { summary: SatisfactionSummaryDTO | undefined; isLoading: boolean }) {
  const [main, ...older] = summary?.questions ?? [];

  return (
    <div className={`flex h-full flex-col rounded-card border border-border bg-surface p-4 ${CHART_CARD_SHADOW}`}>
      <p className="mb-2 text-xs font-medium text-muted">Pesquisa de satisfação (NPS)</p>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted">Carregando...</p>
      ) : !main ? (
        <p className="py-8 text-center text-sm text-muted">Nenhuma pesquisa enviada no período. Ela pode ser ligada em Respostas › Pesquisa.</p>
      ) : (
        <>
          <QuestionBlock question={main} />
          {older.length > 0 && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="focus-ring cursor-pointer rounded text-xs font-medium text-muted">
                {older.length === 1 ? "1 pergunta anterior" : `${older.length} perguntas anteriores`}
              </summary>
              <ul className="mt-3 space-y-4">
                {older.map((q) => (
                  <li key={q.questionId ?? "legacy"} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <QuestionBlock question={q} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
