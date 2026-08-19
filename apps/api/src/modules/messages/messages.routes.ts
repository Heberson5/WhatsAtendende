import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { Errors } from "../../lib/http-error";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import * as service from "./messages.service";
import { toMessageDTO } from "./messages.mapper";
import * as whatsappService from "../whatsapp/whatsapp.service";
import { realtimeEvents } from "../../realtime/realtime";
import { assertAgentCanAccessConversation, getConversationOrThrow } from "../conversations/conversations.service";

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/3gpp",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo nao permitido"));
    }
    cb(null, true);
  },
});

function mimeToMessageType(mime: string): "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

async function loadConversationForAgent(conversationId: string, agentId: string) {
  const conversation = await getConversationOrThrow(conversationId);
  assertAgentCanAccessConversation(conversation, { userId: agentId, role: "AGENT" });
  return conversation;
}

const querySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().min(1).max(100).default(30) });

messagesRouter.get(
  "/conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(req.params.conversationId);
    if (req.auth!.role === "AGENT") assertAgentCanAccessConversation(conversation, req.auth!);
    const { cursor, limit } = querySchema.parse(req.query);
    const result = await service.listMessages({ conversationId: req.params.conversationId, cursor, limit });
    res.json({ items: result.items.map(toMessageDTO), nextCursor: result.nextCursor });
  })
);

const sendTextSchema = z.object({ body: z.string().min(1).max(4096), replyToMessageId: z.string().uuid().optional() });
messagesRouter.post(
  "/conversations/:conversationId/text",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    const { body, replyToMessageId } = sendTextSchema.parse(req.body);

    const message = await service.createOutboundMessage({
      conversationId: conversation.id,
      agentId: req.auth!.userId,
      type: "TEXT",
      body,
      replyToMessageId,
    });

    let replyToProviderMessageId: string | undefined;
    if (replyToMessageId) {
      const original = await prisma.message.findUnique({ where: { id: replyToMessageId } });
      replyToProviderMessageId = original?.providerMessageId ?? undefined;
    }

    const dto = await whatsappService.sendOutboundText(message.id, conversation.contact.phone, body, replyToProviderMessageId);
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

messagesRouter.post(
  "/conversations/:conversationId/file",
  requireRole("AGENT"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    if (!req.file) throw Errors.badRequest("Nenhum arquivo enviado");

    const type = mimeToMessageType(req.file.mimetype);
    const message = await service.createOutboundMessage({
      conversationId: conversation.id,
      agentId: req.auth!.userId,
      type,
      body: (req.body?.caption as string) || null,
    });

    const storageKey = `${randomUUID()}${path.extname(req.file.originalname)}`;
    fs.writeFileSync(path.join(env.UPLOAD_DIR, storageKey), req.file.buffer);
    await service.addAttachment(message.id, {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageKey,
      kind: type,
    });

    const dto = await whatsappService.sendOutboundFile(
      message.id,
      conversation.contact.phone,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      (req.body?.caption as string) || undefined
    );
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

const locationSchema = z.object({ latitude: z.number(), longitude: z.number() });
messagesRouter.post(
  "/conversations/:conversationId/location",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    const { latitude, longitude } = locationSchema.parse(req.body);
    const message = await service.createOutboundMessage({
      conversationId: conversation.id,
      agentId: req.auth!.userId,
      type: "LOCATION",
    });
    await service.addAttachment(message.id, {
      fileName: "location",
      mimeType: "application/geo+json",
      sizeBytes: 0,
      storageKey: "",
      kind: "LOCATION",
      latitude,
      longitude,
    });
    const dto = await whatsappService.sendOutboundLocation(message.id, conversation.contact.phone, latitude, longitude);
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

const reactionSchema = z.object({ emoji: z.string().max(8).nullable() });
messagesRouter.post(
  "/:messageId/reaction",
  requireRole("AGENT"),
  asyncHandler(async (req, res) => {
    const { emoji } = reactionSchema.parse(req.body);
    const message = await service.getMessageWithConversation(req.params.messageId);
    const conversation = await loadConversationForAgent(message.conversationId, req.auth!.userId);
    const updated = await service.toggleReaction(req.params.messageId, req.auth!.userId, emoji);
    if (message.providerMessageId) {
      await whatsappService.sendReaction(conversation.contact.phone, message.providerMessageId, emoji).catch(() => undefined);
    }
    realtimeEvents.messageStatusChanged(conversation.id);
    res.json(toMessageDTO(updated));
  })
);

messagesRouter.get(
  "/attachments/:attachmentId/download",
  asyncHandler(async (req, res) => {
    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { message: { include: { conversation: true } } },
    });
    if (!attachment) throw Errors.notFound();
    if (req.auth!.role === "AGENT") {
      assertAgentCanAccessConversation(attachment.message.conversation, req.auth!);
    }
    if (!attachment.storageKey) throw Errors.notFound("Arquivo sem conteudo binario (ex.: localizacao/vcard)");
    const filePath = path.join(env.UPLOAD_DIR, attachment.storageKey);
    if (!fs.existsSync(filePath)) throw Errors.notFound("Arquivo nao encontrado no armazenamento");
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    res.sendFile(path.resolve(filePath));
  })
);
