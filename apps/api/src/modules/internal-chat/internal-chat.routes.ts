import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { isPermissionAllowed, requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { Errors } from "../../lib/http-error";
import { env } from "../../config/env";
import * as service from "./internal-chat.service";

export const internalChatRouter = Router();
internalChatRouter.use(requireAuth);

const MAX_FILE_MB = 25;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });
const requireUse = requirePermission(PERMISSION.CHAT_INTERNO_USAR);
const requireOversight = requirePermission(PERMISSION.CHAT_INTERNO_ACOMPANHAR);
const beforeSchema = z.object({ before: z.string().datetime().optional() });

// --- Gestão › Chat interno: reads everything, never marks anything as read, every read audited. ---

internalChatRouter.get(
  "/oversight/rooms",
  requireOversight,
  asyncHandler(async (_req, res) => {
    res.json(await service.oversightRooms());
  })
);

internalChatRouter.get(
  "/oversight/rooms/:roomId/messages",
  requireOversight,
  asyncHandler(async (req, res) => {
    const { before } = beforeSchema.parse(req.query);
    const messages = await service.oversightMessages(req.params.roomId, before);
    await writeAudit({ userId: req.auth!.userId, action: "INTERNAL_CHAT_OVERSIGHT_READ", entity: "ChatRoom", entityId: req.params.roomId, ipAddress: req.ip ?? null });
    res.json(messages);
  })
);

internalChatRouter.get(
  "/attachments/:messageId",
  asyncHandler(async (req, res) => {
    const oversight = req.auth!.role === "ADMIN" || (await isPermissionAllowed(req.auth!.role, PERMISSION.CHAT_INTERNO_ACOMPANHAR));
    const message = await service.attachmentFor(req.params.messageId, req.auth!.userId, oversight);
    res.setHeader("Content-Type", message.attachmentMimeType!);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(message.attachmentName!)}"`);
    res.sendFile(path.resolve(env.UPLOAD_DIR, message.attachmentKey!));
  })
);

// --- Using the chat ---

internalChatRouter.use(requireUse);

internalChatRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    res.json(await service.listChatUsers());
  })
);

internalChatRouter.get(
  "/rooms",
  asyncHandler(async (req, res) => {
    res.json(await service.listRooms(req.auth!.userId));
  })
);

internalChatRouter.post(
  "/direct",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    res.json(await service.openDirect(req.auth!.userId, userId));
  })
);

internalChatRouter.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const { name, memberIds } = z.object({ name: z.string().trim().min(1).max(60), memberIds: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
    res.status(201).json(await service.createGroup(req.auth!.userId, name, memberIds));
  })
);

internalChatRouter.get(
  "/rooms/:roomId/messages",
  asyncHandler(async (req, res) => {
    const { before } = beforeSchema.parse(req.query);
    res.json(await service.listMessages(req.params.roomId, req.auth!.userId, before));
  })
);

internalChatRouter.post(
  "/rooms/:roomId/messages",
  asyncHandler(async (req, res) => {
    const input = z.object({ body: z.string().max(4000).optional(), conversationId: z.string().uuid().optional() }).parse(req.body);
    res.status(201).json(await service.sendMessage(req.params.roomId, req.auth!.userId, input));
  })
);

internalChatRouter.post(
  "/rooms/:roomId/files",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw Errors.badRequest("Nenhum arquivo enviado");
    await service.memberOrThrow(req.params.roomId, req.auth!.userId);
    const key = `${randomUUID()}${path.extname(req.file.originalname)}`;
    fs.writeFileSync(path.join(env.UPLOAD_DIR, key), req.file.buffer);
    const body = typeof req.body?.body === "string" ? req.body.body : undefined;
    res.status(201).json(
      await service.sendMessage(req.params.roomId, req.auth!.userId, {
        body,
        attachment: { key, name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size },
      })
    );
  })
);

internalChatRouter.post(
  "/rooms/:roomId/read",
  asyncHandler(async (req, res) => {
    await service.markRead(req.params.roomId, req.auth!.userId);
    res.status(204).end();
  })
);

internalChatRouter.post(
  "/rooms/:roomId/typing",
  asyncHandler(async (req, res) => {
    await service.typing(req.params.roomId, req.auth!.userId);
    res.status(204).end();
  })
);

internalChatRouter.post(
  "/rooms/:roomId/members",
  asyncHandler(async (req, res) => {
    const { userIds, canSeeHistory } = z.object({ userIds: z.array(z.string().uuid()).min(1).max(200), canSeeHistory: z.boolean() }).parse(req.body);
    res.json(await service.addMembers(req.params.roomId, req.auth!.userId, userIds, canSeeHistory));
  })
);

internalChatRouter.put(
  "/rooms/:roomId/members/:userId/admin",
  asyncHandler(async (req, res) => {
    const { admin } = z.object({ admin: z.boolean() }).parse(req.body);
    res.json(await service.setAdmin(req.params.roomId, req.auth!.userId, req.params.userId, admin));
  })
);

internalChatRouter.post(
  "/rooms/:roomId/leave",
  asyncHandler(async (req, res) => {
    await service.leaveGroup(req.params.roomId, req.auth!.userId);
    res.status(204).end();
  })
);
