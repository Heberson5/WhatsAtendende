import type { LucideIcon } from "lucide-react";

/**
 * `onClick` + `goToLabel` turn the card into a shortcut (e.g. Dashboard's
 * conversation-status cards → Gestão, or its Usuários cards → the Usuários
 * screen) — hover highlight and a "Ver em X →" hint only show up when a
 * handler is actually passed, so every other StatCard stays exactly as it
 * was. See PROMPT: "ter a opção de clicar e ser direcionado".
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  onClick,
  goToLabel,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  onClick?: () => void;
  goToLabel?: string;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && e.key === "Enter" && onClick()}
      className={`shadow-soft group relative rounded-card border border-border bg-surface p-4 ${
        onClick ? "focus-ring cursor-pointer transition-all hover:border-primary hover:shadow-[0_0_0_3px_rgba(0,151,180,0.12)]" : ""
      }`}
    >
      {onClick && goToLabel && (
        <span className="absolute bottom-3 right-4 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
          {goToLabel}
        </span>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function formatMinutes(ms: number | null): string {
  if (ms === null) return "-";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}min`;
}
