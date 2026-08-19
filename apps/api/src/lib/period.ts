export type PeriodKey = "today" | "yesterday" | "last7days" | "month" | "lastMonth" | "custom";

export function resolvePeriod(period: PeriodKey, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (period) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "last7days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { from: startOfDay(start), to: endOfDay(now) };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) };
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from: start, to: end };
    }
    case "custom":
      if (!from || !to) throw new Error("custom period requires from and to");
      return { from: startOfDay(from), to: endOfDay(to) };
  }
}
