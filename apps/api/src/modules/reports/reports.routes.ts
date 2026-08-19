import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolvePeriod } from "../../lib/period";
import * as service from "./reports.service";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "last7days", "month", "lastMonth", "custom"]).default("month"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agentId: z.string().uuid().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

function respond(res: import("express").Response, rows: Record<string, unknown>[], format: "json" | "csv", filename: string) {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(service.toCsv(rows));
    return;
  }
  res.json(rows);
}

reportsRouter.get(
  "/attendance",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const rows = await service.getAttendanceReport({ from, to, agentId: query.agentId });
    respond(res, rows, query.format, "relatorio-atendimentos.csv");
  })
);

reportsRouter.get(
  "/per-agent",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const rows = await service.getPerAgentReport({ from, to });
    respond(res, rows, query.format, "relatorio-por-atendente.csv");
  })
);

reportsRouter.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const data = await service.getMessagesReport({ from, to, agentId: query.agentId });
    res.json(data);
  })
);
