import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolvePeriod } from "../../lib/period";
import { parseListParam } from "../../lib/parse-list-param";
import * as service from "./reports.service";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "last7days", "month", "lastMonth", "custom"]).default("month"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agentId: z.string().uuid().optional(),
  connectionId: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.enum(["json", "csv", "pdf", "xlsx"]).default("json"),
});

// See PROMPT: "Relatórios poder extrair em PDF e em xlsx" — alongside the
// existing CSV/JSON. `title`/`baseFilename` are per-report only for the
// PDF heading and download filename; the row-to-document conversion itself
// is shared.
async function respond(res: import("express").Response, rows: Record<string, unknown>[], format: "json" | "csv" | "pdf" | "xlsx", baseFilename: string, title: string) {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${baseFilename}.csv"`);
    res.send(service.toCsv(rows));
    return;
  }
  if (format === "xlsx") {
    const buffer = await service.toXlsx(rows, title);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${baseFilename}.xlsx"`);
    res.send(buffer);
    return;
  }
  if (format === "pdf") {
    const buffer = await service.toPdf(rows, title);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${baseFilename}.pdf"`);
    res.send(buffer);
    return;
  }
  res.json(rows);
}

reportsRouter.get(
  "/attendance",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const rows = await service.getAttendanceReport({ from, to, agentId: query.agentId, connectionIds: parseListParam(query.connectionId) });
    await respond(res, rows, query.format, "relatorio-atendimentos", "Relatório de Atendimentos");
  })
);

reportsRouter.get(
  "/per-agent",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const rows = await service.getPerAgentReport({ from, to, connectionIds: parseListParam(query.connectionId) });
    await respond(res, rows, query.format, "relatorio-por-atendente", "Relatório por Atendente");
  })
);

reportsRouter.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const data = await service.getMessagesReport({ from, to, agentId: query.agentId, connectionIds: parseListParam(query.connectionId) });
    if (query.format === "json") return res.json(data);
    // The other export formats need rows, not a single stats object — wrap it as one row.
    await respond(res, [data], query.format, "relatorio-mensagens", "Relatório de Mensagens");
  })
);
