import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Settings2 } from "lucide-react";
import type { PresenceByHourDTO } from "@whatsatendende/types";
import { CHART_CARD_SHADOW, CHART_DEPTH_FILTER, CHART_TOOLTIP_PROPS, NEUTRAL_SERIES_COLOR, darken, gradientId, lighten } from "../../lib/chart-theme";

const PAUSE_COLOR = "#F59E0B";

function seriesColor(index: number, primaryColor: string, secondaryColor: string): string {
  const base = [primaryColor, PAUSE_COLOR, secondaryColor, NEUTRAL_SERIES_COLOR, lighten(primaryColor, 0.3), darken(secondaryColor, 0.25)];
  return base[index % base.length];
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}h`;
}

export interface HourRange {
  start: number;
  end: number;
}

/**
 * Dashboard section 8 — "Presença ao longo do dia": stacked columns showing,
 * for each hour, how many agents were Online vs Paused (per motivo). For
 * period="Hoje" the hours are trimmed to "now" — never an empty future hour
 * — since the day genuinely hasn't happened yet; any other period already
 * covers full past days, so every hour shows. The gear icon lets anyone
 * narrow the displayed range (e.g. 8h-20h to cut an empty overnight) and
 * optionally save it as their own default for next time.
 */
export function PresenceByHourChart({
  data,
  isLoading,
  isToday,
  primaryColor,
  secondaryColor,
  initialRange,
  onSaveDefaultRange,
}: {
  data: PresenceByHourDTO | undefined;
  isLoading: boolean;
  isToday: boolean;
  primaryColor: string;
  secondaryColor: string;
  initialRange: HourRange | null;
  onSaveDefaultRange: (range: HourRange | null) => void;
}) {
  const [range, setRange] = useState<HourRange | null>(initialRange);
  const [gearOpen, setGearOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(initialRange?.start ?? 8);
  const [draftEnd, setDraftEnd] = useState(initialRange?.end ?? 20);
  const [draftAsDefault, setDraftAsDefault] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const series = data?.series ?? [];
  const currentLocalHour = new Date().getHours();

  const chartData = (data?.hours ?? [])
    .filter((p) => !range || (p.hour >= range.start && p.hour <= range.end))
    .filter((p) => !isToday || p.hour <= currentLocalHour)
    .map((p) => {
      const row: Record<string, unknown> = { hourLabel: formatHour(p.hour) };
      for (const key of series) row[key] = p.counts[key] ?? 0;
      return row;
    });

  function applyDraft() {
    if (draftStart >= draftEnd) return;
    setRange({ start: draftStart, end: draftEnd });
    if (draftAsDefault) onSaveDefaultRange({ start: draftStart, end: draftEnd });
    setGearOpen(false);
  }

  function showAllHours() {
    setRange(null);
    setGearOpen(false);
    if (draftAsDefault) onSaveDefaultRange(null);
  }

  const barIds = series.map((key, i) => gradientId("presbar", seriesColor(i, primaryColor, secondaryColor)));

  return (
    <div className={`rounded-card border border-border bg-surface p-4 ${CHART_CARD_SHADOW}`}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted">Presença ao longo do dia</p>
        <div ref={gearRef} className="relative">
          <button
            onClick={() => setGearOpen((o) => !o)}
            className="focus-ring rounded-md p-1 text-muted hover:bg-surface-alt hover:text-[var(--color-text)]"
            title="Configurar faixa de horário"
            aria-label="Configurar faixa de horário"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {gearOpen && (
            <div className="shadow-soft absolute right-0 top-full z-20 mt-1 w-64 rounded-card border border-border bg-surface p-3">
              <p className="mb-2 text-xs font-semibold">Faixa de horário exibida</p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">De</span>
                <select
                  value={draftStart}
                  onChange={(e) => setDraftStart(Number(e.target.value))}
                  className="focus-ring flex-1 rounded-card border border-border bg-transparent px-2 py-1.5 text-sm"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
                <span className="text-muted">até</span>
                <select
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(Number(e.target.value))}
                  className="focus-ring flex-1 rounded-card border border-border bg-transparent px-2 py-1.5 text-sm"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </div>
              {draftStart >= draftEnd && <p className="mt-1 text-xs text-red-600">O horário inicial deve ser antes do final.</p>}
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draftAsDefault}
                  onChange={(e) => setDraftAsDefault(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Definir como padrão pro meu Dashboard
              </label>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button onClick={showAllHours} className="text-xs text-muted hover:underline">
                  Mostrar todas as horas
                </button>
                <button
                  onClick={applyDraft}
                  disabled={draftStart >= draftEnd}
                  className="focus-ring rounded-card bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted">Carregando...</p>
      ) : chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Sem dados de presença no período selecionado.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} style={{ filter: CHART_DEPTH_FILTER }}>
            <defs>
              {series.map((key, i) => (
                <linearGradient key={barIds[i]} id={barIds[i]} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lighten(seriesColor(i, primaryColor, secondaryColor), 0.25)} />
                  <stop offset="100%" stopColor={darken(seriesColor(i, primaryColor, secondaryColor), 0.1)} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="hourLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_PROPS} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} name={key} stackId="presence" fill={`url(#${barIds[i]})`} radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
