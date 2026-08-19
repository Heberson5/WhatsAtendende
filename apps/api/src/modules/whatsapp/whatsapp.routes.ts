import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import * as service from "./whatsapp.service";

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get(
  "/status",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    res.json(await service.getConnectionStatus());
  })
);

whatsappRouter.post(
  "/connect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    // Connecting (QR generation, then the real handshake) takes seconds —
    // the client polls GET /status (and listens for the whatsapp:status
    // socket event) rather than blocking this request on the whole flow.
    service.connect().catch((err) => logger.error({ err }, "whatsapp connect failed"));
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECT_REQUESTED", entity: "WhatsAppConnection", ipAddress: req.ip ?? null });
    res.status(202).json(await service.getConnectionStatus());
  })
);

whatsappRouter.post(
  "/disconnect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await service.disconnect();
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_DISCONNECTED", entity: "WhatsAppConnection", ipAddress: req.ip ?? null });
    res.json(await service.getConnectionStatus());
  })
);

whatsappRouter.post(
  "/reconnect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await service.disconnect();
    service.connect().catch((err) => logger.error({ err }, "whatsapp reconnect failed"));
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_RECONNECT_REQUESTED", entity: "WhatsAppConnection", ipAddress: req.ip ?? null });
    res.status(202).json(await service.getConnectionStatus());
  })
);
