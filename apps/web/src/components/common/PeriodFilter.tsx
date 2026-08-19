import { useState } from "react";

export type PeriodKey = "today" | "yesterday" | "last7days" | "month" | "lastMonth" | "custom";

export interface PeriodValue {
  period: PeriodKey;
  from?: string;
  to?: string;
}

const OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7days", label: "Últimos 7 dias" },
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês anterior" },
  { value: "custom", label: "Personalizado" },
];

export function PeriodFilter({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [customFrom, setCustomFrom] = useState(value.from ?? "");
  const [customTo, setCustomTo] = useState(value.to ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value.period}
        onChange={(e) => onChange({ period: e.target.value as PeriodKey, from: customFrom, to: customTo })}
        className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {value.period === "custom" && (
        <>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              onChange({ period: "custom", from: e.target.value, to: customTo });
            }}
            className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
          />
          <span className="text-muted">até</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              onChange({ period: "custom", from: customFrom, to: e.target.value });
            }}
            className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
          />
        </>
      )}
    </div>
  );
}
