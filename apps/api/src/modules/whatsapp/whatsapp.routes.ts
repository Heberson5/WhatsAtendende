import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
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

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const createSchema = z.object({ name: z.string().trim().min(1).max(60), color: colorSchema.optional() });
const updateSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), color: colorSchema.optional() });

whatsappRouter.post(
  "/connections",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { name, color } = createSchema.parse(req.body);
    const connection = await service.createConnection(name, color);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECTION_CREATED", entity: "WhatsAppConnection", entityId: connection.id, ipAddress: req.ip ?? null, metadata: { name } });
    res.status(201).json(connection);
  })
);

whatsappRouter.patch(
  "/connections/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const patch = updateSchema.parse(req.body);
    const connection = await service.updateConnection(req.params.id, patch);
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECTION_UPDATED", entity: "WhatsAppConnection", entityId: connection.id, ipAddress: req.ip ?? null, metadata: patch });
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

const connectSchema = z.object({ phoneNumber: z.string().trim().regex(/^\d{8,15}$/).optional() });

whatsappRouter.post(
  "/connections/:id/connect",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    // Connecting (QR/pairing-code generation, then the real handshake) takes
    // seconds — the client polls GET /connections (and listens for the
    // whatsapp:status socket event) rather than blocking this request on the
    // whole flow. phoneNumber, when given, requests a WhatsApp-Web-style
    // pairing code instead of a QR code — see PROMPT: "conexão... também
    // poderá ser feito via código".
    const { phoneNumber } = connectSchema.parse(req.body ?? {});
    service.connect(req.params.id, phoneNumber).catch((err) => logger.error({ err }, "whatsapp connect failed"));
    await writeAudit({ userId: req.auth!.userId, action: "WHATSAPP_CONNECT_REQUESTED", entity: "WhatsAppConnection", entityId: req.params.id, ipAddress: req.ip ?? null, metadata: { viaPairingCode: Boolean(phoneNumber) } });
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

// Device contacts, for "start a new conversation" in Atendimento — see
// PROMPT: "adicionar uma nova conversa através dos contatos salvos no
// celular de cada instância". An agent may only browse their own
// connection's contacts; managers/admins (who can attend any connection)
// may browse any.
whatsappRouter.get(
  "/connections/:id/contacts",
  asyncHandler(async (req, res) => {
    if (req.auth!.role === "AGENT") {
      const agent = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { whatsappConnectionId: true } });
      if (agent?.whatsappConnectionId !== req.params.id) throw Errors.forbidden("Voce so pode ver os contatos da sua propria conexao");
    }
    res.json(await service.listContacts(req.params.id));
  })
);
