import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import * as service from "./whatsapp.service";

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

// Full list with QR/status — admins manage connections, managers read them for dashboard/report filters.
whatsappRouter.get(
  "/connections",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    res.json(await service.listConnections());
  })
);

const nameSchema = z.object({ name: z.string().trim().min(1).max(60) });

whatsappRouter.post(
  "/connections",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { name } = nameSchema.parse(req.body);
    const connection = await service.createConnection(name);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECTION_CREATED", entity: "WhatsAppConnection", entityId: connection.id, ipAddress: req.ip ?? null, metadata: { name } });
    res.status(201).json(connection);
  })
);

whatsappRouter.patch(
  "/connections/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { name } = nameSchema.parse(req.body);
    const connection = await service.renameConnection(req.params.id, name);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECTION_RENAMED", entity: "WhatsAppConnection", entityId: connection.id, ipAddress: req.ip ?? null, metadata: { name } });
    res.json(connection);
  })
);

whatsappRouter.delete(
  "/connections/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await service.deleteConnection(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECTION_DELETED", entity: "WhatsAppConnection", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(204).end();
  })
);

whatsappRouter.post(
  "/connections/:id/connect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    // Connecting (QR generation, then the real handshake) takes seconds —
    // the client polls GET /connections (and listens for the whatsapp:status
    // socket event) rather than blocking this request on the whole flow.
    service.connect(req.params.id).catch((err) => logger.error({ err }, "whatsapp connect failed"));
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECT_REQUESTED", entity: "WhatsAppConnection", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(202).json(await service.getConnectionSummary(req.params.id));
  })
);

whatsappRouter.post(
  "/connections/:id/disconnect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await service.disconnect(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_DISCONNECTED", entity: "WhatsAppConnection", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.json(await service.getConnectionSummary(req.params.id));
  })
);

whatsappRouter.post(
  "/connections/:id/reconnect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await service.disconnect(req.params.id);
    service.connect(req.params.id).catch((err) => logger.error({ err }, "whatsapp reconnect failed"));
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_RECONNECT_REQUESTED", entity: "WhatsAppConnection", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(202).json(await service.getConnectionSummary(req.params.id));
  })
);
