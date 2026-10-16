import clsx from "clsx";
import { Keyboard } from "lucide-react";
import { useMyDay } from "../../hooks/useAgentExtras";
import { formatMinutes } from "../../lib/dashboardMetrics";

/** "Meu dia" above the conversation list: closed today (against the daily goal), average first response, this month's NPS. */
export function MyDayStrip({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { data } = useMyDay();
  const goal = data?.goal ?? null;
  const progress = goal && data ? Math.min(100, Math.round((data.closedToday / goal) * 100)) : 0;
  return (
    <div className="space-y-1.5 rounded-[10px] border border-border bg-surface-alt px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Meu dia</span>
        <button
          onClick={onShowShortcuts}
          className="focus-ring flex items-center gap-1 rounded px-1 text-[11px] text-muted hover:text-[var(--color-text)]"
          title="Atalhos do teclado (?)"
          aria-label="Atalhos do teclado"
        >
          <Keyboard className="h-3.5 w-3.5" /> ?
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Stat label="Atendidas hoje" value={data ? (goal ? `${data.closedToday}/${goal}` : String(data.closedToday)) : "—"} />
        <Stat label="1ª resposta" value={data ? formatMinutes(data.avgFirstResponseMs) : "—"} />
        <Stat label="NPS do mês" value={data?.npsThisMonth ?? null} nps />
      </div>
      {goal !== null && data && (
        <div className="flex items-center gap-2" title={`Meta do dia: ${goal} atendimentos encerrados`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/70">
            <div className={clsx("h-full rounded-full", progress >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10.5px] font-semibold tabular-nums text-muted">{progress >= 100 ? "Meta batida!" : `${progress}%`}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, nps }: { label: string; value: string | number | null; nps?: boolean }) {
  const shown = value === null ? "—" : String(value);
  return (
    <div className="min-w-0">
      <p
        className={clsx(
          "truncate text-[15px] font-bold tabular-nums leading-5",
          nps && typeof value === "number" && (value >= 50 ? "text-success" : value < 0 ? "text-danger" : "text-warning")
        )}
      >
        {shown}
      </p>
      <p className="truncate text-[10.5px] text-muted">{label}</p>
    </div>
  );
}
