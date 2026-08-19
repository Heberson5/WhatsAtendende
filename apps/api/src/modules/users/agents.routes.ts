import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";

/** Lightweight agent listings used by the transfer modal and management screens (not full user CRUD). */
export const agentsRouter = Router();
agentsRouter.use(requireAuth);

agentsRouter.get(
  "/transfer-targets",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const agents = await prisma.user.findMany({
      where: { role: "AGENT", status: "ACTIVE", id: { not: req.auth!.userId } },
      select: { id: true, displayName: true, presence: true },
      orderBy: { displayName: "asc" },
    });
    res.json(agents);
  })
);

agentsRouter.get(
  "/",
  requireRole("MANAGER", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const agents = await prisma.user.findMany({
      where: { role: "AGENT" },
      select: { id: true, displayName: true, presence: true, status: true },
      orderBy: { displayName: "asc" },
    });
    res.json(agents);
  })
);
