import type PptxGenJS from "pptxgenjs";
import type { PresenceByHourDTO } from "@whatsatendende/types";
import type { ExportBranding } from "../hooks/useExportBranding";
import type { PeriodValue } from "../components/common/PeriodFilter";
import type { HourRange } from "../components/dashboard/PresenceByHourChart";
import { formatMinutes } from "../components/common/StatCard";
import { darken, lighten, NEUTRAL_SERIES_COLOR } from "./chart-theme";

interface DashboardData {
  conversations: { received: number; unique: number; inProgress: number; closed: number; waiting: number };
  messages: { received: number; sent: number; total: number };
  timings: { avgAcceptMs: number | null; avgFirstResponseMs: number | null; avgHandlingMs: number | null; avgClosingMs: number | null };
  perAgent: { agentId: string; agentName: string; conversations: number; messagesSent: number; messagesReceived: number; avgHandlingMs: number | null }[];
  users: { online: number; active: number; total: number };
}

// Same palette logic as PresenceByHourChart.tsx's own seriesColor — kept
// visually consistent between the on-screen chart and the exported slide.
const PAUSE_COLOR = "#F59E0B";
function presenceSeriesColor(index: number, primaryColor: string, secondaryColor: string): string {
  const base = [primaryColor, PAUSE_COLOR, secondaryColor, NEUTRAL_SERIES_COLOR, lighten(primaryColor, 0.3), darken(secondaryColor, 0.25)];
  return base[index % base.length];
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}h`;
}

const PERIOD_LABELS: Record<PeriodValue["period"], string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last7days: "Últimos 7 dias",
  month: "Este mês",
  lastMonth: "Mês anterior",
  custom: "Período personalizado",
  all: "Todo o período",
};

function periodLabel(period: PeriodValue): string {
  if (period.period === "custom" && period.from && period.to) return `${period.from} a ${period.to}`;
  return PERIOD_LABELS[period.period];
}

/** pptxgenjs wants hex without the leading "#". */
function hex(color: string): string {
  return color.replace("#", "");
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    // A missing/unreachable logo shouldn't block the whole export — the
    // cover slide just renders without it.
    return null;
  }
}

function loadImageSize(dataUri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * Exports the Dashboard as a formatted, editable PowerPoint deck: a cover
 * slide, a consolidated KPI table, and the three charts as native PPT
 * charts (not screenshots) — so a director can tweak colors/labels
 * directly in PowerPoint. See PROMPT: "forma de exportar em Power Point
 * bem formatado para ser apresentável à diretoria".
 */
export async function exportDashboardPptx({
  data,
  period,
  branding,
  statusColors,
  messageColors,
  agentSeriesColors,
  wordCloud,
  presenceByHour,
  presenceHourRange,
  presenceIsToday,
  primaryColor: dashboardPrimaryColor,
  secondaryColor: dashboardSecondaryColor,
}: {
  data: DashboardData;
  period: PeriodValue;
  branding: ExportBranding | null;
  statusColors: string[];
  messageColors: string[];
  agentSeriesColors: string[];
  wordCloud: { word: string; count: number }[];
  presenceByHour: PresenceByHourDTO | undefined;
  presenceHourRange: HourRange | null;
  presenceIsToday: boolean;
  primaryColor: string;
  secondaryColor: string;
}): Promise<void> {
  const primary = branding?.primaryColor ?? "#0097B4";
  const primaryDark = darken(primary, 0.25);
  const companyName = branding?.companyName ?? "WhatsAtendende";
  const logoDataUri = branding?.logoUrl ? await toDataUri(branding.logoUrl) : null;
  const logoNaturalSize = logoDataUri ? await loadImageSize(logoDataUri) : null;
  // Fit within a 1in-tall, 2.2in-wide box, preserving the logo's own aspect
  // ratio — avoids pptxgenjs's `sizing: "contain"` letterbox trick (a
  // negative-crop + stretch combo some viewers, notably Google Slides,
  // render as an actual stretch instead of a letterbox). See PROMPT: "a
  // logo está desconfigurada".
  const LOGO_MAX_W = 2.2;
  const LOGO_MAX_H = 1;
  const logoScale = logoNaturalSize ? Math.min(LOGO_MAX_W / logoNaturalSize.width, LOGO_MAX_H / logoNaturalSize.height) : 1;
  const logoW = logoNaturalSize ? logoNaturalSize.width * logoScale : LOGO_MAX_H;
  const logoH = logoNaturalSize ? logoNaturalSize.height * logoScale : LOGO_MAX_H;

  // pptxgenjs pulls in jszip and adds ~400KB to the bundle — loaded on
  // demand here so every visitor doesn't pay for it just to view charts.
  const { default: PptxGen } = await import("pptxgenjs");
  const pptx = new PptxGen() as PptxGenJS;
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = companyName;
  pptx.title = `Dashboard de Atendimento — ${periodLabel(period)}`;

  const SLIDE_W = 13.33;
  const generatedAt = new Date().toLocaleString("pt-BR");

  function addFooter(slide: PptxGenJS.Slide, pageLabel: string) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.35, w: SLIDE_W, h: 0.15, fill: { color: hex(primary) } });
    slide.addText(companyName, { x: 0.4, y: 7.15, w: 6, h: 0.25, fontSize: 9, color: "94A3B8", fontFace: "Arial" });
    slide.addText(pageLabel, { x: SLIDE_W - 6.4, y: 7.15, w: 6, h: 0.25, fontSize: 9, color: "94A3B8", fontFace: "Arial", align: "right" });
  }

  // ---- Slide 1: capa ----
  const cover = pptx.addSlide();
  cover.background = { color: "FFFFFF" };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 2.1, fill: { color: hex(primary) } });
  if (logoDataUri) {
    cover.addImage({ data: logoDataUri, x: 0.6, y: 0.55 + (LOGO_MAX_H - logoH) / 2, w: logoW, h: logoH });
  }
  cover.addText(companyName, {
    x: logoDataUri ? 0.6 + logoW + 0.3 : 0.6,
    y: 0.85,
    w: 8,
    h: 0.5,
    fontSize: 20,
    bold: true,
    color: "FFFFFF",
    fontFace: "Arial",
  });
  cover.addText("Dashboard de Atendimento", {
    x: 0.6,
    y: 2.7,
    w: 12,
    h: 0.9,
    fontSize: 34,
    bold: true,
    color: "1E293B",
    fontFace: "Arial",
  });
  cover.addText(`${periodLabel(period)}  •  Gerado em ${generatedAt}`, {
    x: 0.6,
    y: 3.55,
    w: 12,
    h: 0.4,
    fontSize: 14,
    color: "64748B",
    fontFace: "Arial",
  });
  cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.15, w: 1.4, h: 0.06, fill: { color: hex(primaryDark) } });

  // ---- Slide 2: indicadores ----
  const kpiSlide = pptx.addSlide();
  kpiSlide.addText("Indicadores do período", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 24, bold: true, color: "1E293B", fontFace: "Arial" });

  const sectionRow = (label: string) => [
    {
      text: label,
      options: { colspan: 2, fill: { color: hex(primary) }, color: "FFFFFF", bold: true, fontSize: 12, fontFace: "Arial" },
    },
  ];
  const metricRow = (label: string, value: string | number) => [
    { text: label, options: { fontSize: 11, color: "334155", fontFace: "Arial" } },
    { text: String(value), options: { fontSize: 11, bold: true, color: "1E293B", fontFace: "Arial", align: "right" as const } },
  ];

  kpiSlide.addTable(
    [
      sectionRow("Usuários"),
      metricRow("Online agora", data.users.online),
      metricRow("Ativos", data.users.active),
      metricRow("Total", data.users.total),
      sectionRow("Conversas"),
      metricRow("Recebidas", data.conversations.received),
      metricRow("Atendimentos únicos", data.conversations.unique),
      metricRow("Aguardando", data.conversations.waiting),
      metricRow("Em atendimento", data.conversations.inProgress),
      metricRow("Encerradas", data.conversations.closed),
      sectionRow("Mensagens"),
      metricRow("Recebidas", data.messages.received),
      metricRow("Enviadas", data.messages.sent),
      metricRow("Total", data.messages.total),
      sectionRow("Tempos médios de atendimento"),
      metricRow("Aceite", formatMinutes(data.timings.avgAcceptMs)),
      metricRow("1ª resposta", formatMinutes(data.timings.avgFirstResponseMs)),
      metricRow("Atendimento", formatMinutes(data.timings.avgHandlingMs)),
      metricRow("Até encerramento", formatMinutes(data.timings.avgClosingMs)),
    ],
    {
      x: 0.5,
      y: 1.05,
      w: 7.5,
      colW: [5, 2.5],
      border: { type: "solid", color: "E2E8F0", pt: 0.5 },
      autoPage: false,
    }
  );
  addFooter(kpiSlide, "2");

  // ---- Slide 3: conversas por status (rosca nativa, editável) ----
  const statusData = [
    { name: "Aguardando", value: data.conversations.waiting },
    { name: "Em atendimento", value: data.conversations.inProgress },
    { name: "Encerradas", value: data.conversations.closed },
  ];
  if (statusData.some((d) => d.value > 0)) {
    const slide = pptx.addSlide();
    slide.addText("Conversas por status", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
    slide.addChart(
      pptx.ChartType.doughnut,
      [{ name: "Conversas", labels: statusData.map((d) => d.name), values: statusData.map((d) => d.value) }],
      {
        x: 1.8,
        y: 1.1,
        w: 9.7,
        h: 6,
        chartColors: statusColors.map(hex),
        showLegend: true,
        legendPos: "b",
        showValue: true,
        showPercent: true,
        dataLabelColor: "FFFFFF",
        holeSize: 55,
      }
    );
    addFooter(slide, "3");
  }

  // ---- Slide 4: mensagens recebidas x enviadas (pizza nativa) ----
  const messageData = [
    { name: "Recebidas", value: data.messages.received },
    { name: "Enviadas", value: data.messages.sent },
  ];
  if (messageData.some((d) => d.value > 0)) {
    const slide = pptx.addSlide();
    slide.addText("Mensagens recebidas x enviadas", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
    slide.addChart(
      pptx.ChartType.pie,
      [{ name: "Mensagens", labels: messageData.map((d) => d.name), values: messageData.map((d) => d.value) }],
      {
        x: 1.8,
        y: 1.1,
        w: 9.7,
        h: 6,
        chartColors: messageColors.map(hex),
        showLegend: true,
        legendPos: "b",
        showValue: true,
        showPercent: true,
        dataLabelColor: "FFFFFF",
      }
    );
    addFooter(slide, "4");
  }

  // ---- Slide 5: palavras mais usadas pelos clientes ----
  // PowerPoint has no native "word cloud" chart object, so this becomes a
  // ranked table instead — see PROMPT: "Slide com tabela 'Palavra —
  // Menções', ordenada da mais pra menos citada".
  if (wordCloud.length > 0) {
    const slide = pptx.addSlide();
    slide.addText("Palavras mais usadas pelos clientes", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
    const headerRow = [
      { text: "Palavra", options: { fill: { color: hex(primary) }, color: "FFFFFF", bold: true, fontSize: 12, fontFace: "Arial" } },
      { text: "Menções", options: { fill: { color: hex(primary) }, color: "FFFFFF", bold: true, fontSize: 12, fontFace: "Arial", align: "right" as const } },
    ];
    const wordRows = wordCloud.map((w) => [
      { text: w.word, options: { fontSize: 11, color: "334155", fontFace: "Arial" } },
      { text: String(w.count), options: { fontSize: 11, bold: true, color: "1E293B", fontFace: "Arial", align: "right" as const } },
    ]);
    // Two columns side by side so a long list doesn't spill past one slide.
    const half = Math.ceil(wordRows.length / 2);
    slide.addTable([headerRow, ...wordRows.slice(0, half)], {
      x: 0.5,
      y: 1.05,
      w: 5.8,
      colW: [4, 1.8],
      border: { type: "solid", color: "E2E8F0", pt: 0.5 },
      autoPage: false,
    });
    if (wordRows.length > half) {
      slide.addTable([headerRow, ...wordRows.slice(half)], {
        x: 6.8,
        y: 1.05,
        w: 5.8,
        colW: [4, 1.8],
        border: { type: "solid", color: "E2E8F0", pt: 0.5 },
        autoPage: false,
      });
    }
    addFooter(slide, "5");
  }

  // ---- Slide 6: conversas por atendente (barras 3D nativas) ----
  if (data.perAgent.length > 0) {
    const slide = pptx.addSlide();
    slide.addText("Conversas por atendente", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
    slide.addChart(
      pptx.ChartType.bar3d,
      [{ name: "Conversas", labels: data.perAgent.map((a) => a.agentName), values: data.perAgent.map((a) => a.conversations) }],
      {
        x: 0.5,
        y: 1.1,
        w: 12.3,
        h: 5.8,
        barDir: "col",
        bar3DShape: "box",
        chartColors: [hex(agentSeriesColors[0])],
        showLegend: true,
        legendPos: "b",
        catAxisLabelColor: "334155",
        valAxisLabelColor: "334155",
      }
    );
    addFooter(slide, "6");
  }

  // ---- Slide 7: mensagens enviadas x recebidas por atendente (barras 3D nativas) ----
  if (data.perAgent.length > 0) {
    const slide = pptx.addSlide();
    slide.addText("Mensagens enviadas x recebidas por atendente", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
    slide.addChart(
      pptx.ChartType.bar3d,
      [
        { name: "Enviadas", labels: data.perAgent.map((a) => a.agentName), values: data.perAgent.map((a) => a.messagesSent) },
        { name: "Recebidas", labels: data.perAgent.map((a) => a.agentName), values: data.perAgent.map((a) => a.messagesReceived) },
      ],
      {
        x: 0.5,
        y: 1.1,
        w: 12.3,
        h: 5.8,
        barDir: "col",
        bar3DShape: "box",
        chartColors: [hex(messageColors[1]), hex(messageColors[0])],
        showLegend: true,
        legendPos: "b",
        catAxisLabelColor: "334155",
        valAxisLabelColor: "334155",
      }
    );
    addFooter(slide, "7");
  }

  // ---- Slide 8: presença ao longo do dia (colunas empilhadas nativas) ----
  // Mirrors PresenceByHourChart.tsx exactly: same hour-range filter, same
  // "Hoje" progressive truncation, same series colors — see PROMPT: "Novo
  // gráfico de colunas empilhadas nativo... respeitando a faixa de horário
  // configurada".
  if (presenceByHour && presenceByHour.series.length > 0) {
    const currentLocalHour = new Date().getHours();
    const points = presenceByHour.hours
      .filter((p) => !presenceHourRange || (p.hour >= presenceHourRange.start && p.hour <= presenceHourRange.end))
      .filter((p) => !presenceIsToday || p.hour <= currentLocalHour);
    if (points.length > 0) {
      const slide = pptx.addSlide();
      slide.addText("Presença ao longo do dia", { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: "1E293B", fontFace: "Arial" });
      const labels = points.map((p) => formatHour(p.hour));
      const series = presenceByHour.series.map((key, i) => ({
        name: key,
        labels,
        values: points.map((p) => p.counts[key] ?? 0),
        color: hex(presenceSeriesColor(i, dashboardPrimaryColor, dashboardSecondaryColor)),
      }));
      slide.addChart(
        pptx.ChartType.bar,
        series.map(({ name, labels: lbl, values }) => ({ name, labels: lbl, values })),
        {
          x: 0.5,
          y: 1.1,
          w: 12.3,
          h: 5.8,
          barDir: "col",
          barGrouping: "stacked",
          chartColors: series.map((s) => s.color),
          showLegend: true,
          legendPos: "b",
          catAxisLabelColor: "334155",
          valAxisLabelColor: "334155",
          catAxisLabelFontSize: 8,
        }
      );
      addFooter(slide, "8");
    }
  }

  await pptx.writeFile({ fileName: `dashboard-${period.period}-${new Date().toISOString().slice(0, 10)}.pptx` });
}
