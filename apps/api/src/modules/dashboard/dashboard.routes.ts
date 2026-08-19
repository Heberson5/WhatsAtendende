import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { resolvePeriod } from "../../lib/period";
import { getDashboard } from "./dashboard.service";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));

const querySchema = z.object({
  period: z.enum(["today", "yesterday", "last7days", "month", "lastMonth", "custom"]).default("today"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agentId: z.string().uuid().optional(),
});

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = querySchema.parse(req.query);
    const { from, to } = resolvePeriod(query.period, query.from, query.to);
    const data = await getDashboard({ from, to, agentId: query.agentId });
    res.json(data);
  })
);
