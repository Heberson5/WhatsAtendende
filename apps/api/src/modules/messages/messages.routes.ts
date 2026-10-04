import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { verifyAccessToken } from "../auth/jwt";
import { isSessionActive } from "../../lib/session";
import { Errors } from "../../lib/http-error";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../../lib/audit";
import { transcodeToOggOpus } from "../../lib/audio-transcode";
import * as service from "./messages.service";
import { toMessageDTO } from "./messages.mapper";
import * as whatsappService from "../whatsapp/whatsapp.service";
import * as metaService from "../meta/meta.service";
import * as templatesService from "../message-templates/message-templates.service";
import { toMessageTemplateDTO } from "../message-templates/message-templates.mapper";
import { realtimeEvents } from "../../realtime/realtime";
import { assertAgentCanAccessConversation, assertAgentCanReadConversation, getConversationOrThrow } from "../conversations/conversations.service";

export const messagesRouter = Router();

// An <img>/<video>/<audio> tag can't attach an Authorization header, so the
// attachment download route alone also accepts the access token as a query
// param — registered before the router-wide requireAuth below so it isn't
// forced through the header-only path. The token stays short-lived (same
// TTL as everywhere else), so this only exposes a brief window even if a
// URL leaks via referrer/history — an acceptable trade-off for an internal
// tool versus fetching every message image as an authenticated blob.
async function requireAuthFromHeaderOrQuery(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : queryToken;
  if (!token) return next(Errors.unauthorized());
  try {
    const payload = verifyAccessToken(token);
    // See lib/session.ts / middleware/auth.ts's requireAuth — same
    // single-active-session enforcement, applied here too since this route
    // is the one place that accepts the access token outside the
    // Authorization header (see the comment above).
    if (!(await isSessionActive(payload.sid))) {
      return next(Errors.unauthorized("Sessao encerrada — login realizado em outro dispositivo"));
    }
    req.auth = { userId: payload.sub, role: payload.role, displayName: payload.displayName };
    next();
  } catch {
    next(Errors.unauthorized("Token invalido ou expirado"));
  }
}

messagesRouter.get(
  "/attachments/:attachmentId/download",
  requireAuthFromHeaderOrQuery,
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

messagesRouter.use(requireAuth);

// MANAGER/ADMIN can also own and work a conversation in Atendimento (see
// conversations.routes.ts) — restricting sending to AGENT alone would let
// them accept a conversation but never reply in it. Same configurable
// permission as conversations.routes.ts's attendance gate.
const requireAttendanceAccess = requirePermission(PERMISSION.ATENDIMENTO_ACESSAR);

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
  // Safari's MediaRecorder (used by the in-app voice-note recorder) has no
  // WebM support and falls back to this instead — ffmpeg transcodes it to
  // OGG/Opus the same as any other recording before it reaches WhatsApp,
  // see the /conversations/:conversationId/audio route below.
  "audio/mp4",
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
  // Shared by every outbound send route (text/file/audio/location) — a
  // disconnected connection can't actually deliver anything, so block it
  // here once instead of duplicating the check in each route. Exactly one
  // of whatsappConnection/metaConnection is populated (see Channel's doc
  // comment in schema.prisma).
  const connectionStatus = conversation.channel === "WHATSAPP" ? conversation.whatsappConnection?.status : conversation.metaConnection?.status;
  if (connectionStatus !== "CONNECTED") {
    throw Errors.badRequest("A conexao esta desconectada — nao e possivel enviar mensagens");
  }
  return conversation;
}

// Arquivo/áudio/localização/reação ainda só existem para WhatsApp — ver
// PROMPT: "prepare tudo para integrar com Instagram e Facebook" (esse
// pedido cobriu texto; anexos ficam para depois, já que a API da Meta
// entrega mídia como uma URL de CDN a baixar, não como bytes prontos como
// o Baileys entrega). Checado antes de qualquer escrita no banco, não
// depois — evita criar uma mensagem PENDING que nunca seria enviada.
function assertWhatsAppChannel(conversation: { channel: string }, feature: string): void {
  if (conversation.channel !== "WHATSAPP") {
    throw Errors.badRequest(`${feature} ainda não é suportado para Instagram/Messenger`);
  }
}

const querySchema = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().min(1).max(100).default(30) });

messagesRouter.get(
  "/conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(req.params.conversationId);
    if (req.auth!.role === "AGENT") await assertAgentCanReadConversation(conversation, req.auth!);
    const { cursor, limit } = querySchema.parse(req.query);
    const result = await service.listMessages({ contactId: conversation.contactId, cursor, limit });
    res.json({ items: result.items.map(toMessageDTO), nextCursor: result.nextCursor });
  })
);

const sendTextSchema = z.object({ body: z.string().min(1).max(4096), replyToMessageId: z.string().uuid().optional() });
messagesRouter.post(
  "/conversations/:conversationId/text",
  requireAttendanceAccess,
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
    let replyToText: string | null | undefined;
    if (replyToMessageId) {
      const original = await prisma.message.findUnique({ where: { id: replyToMessageId } });
      replyToProviderMessageId = original?.providerMessageId ?? undefined;
      replyToText = original?.body;
    }

    const dto =
      conversation.channel === "WHATSAPP"
        ? await whatsappService.sendOutboundText(
            conversation.whatsappConnectionId!,
            message.id,
            conversation.contact.phone!,
            body,
            req.auth!.displayName,
            replyToProviderMessageId,
            replyToText
          )
        : // Instagram/Messenger have no reply-to-quote or sender-name-prefix
          // concept on the Send API — just the bare text.
          await metaService.sendMetaMessage(conversation.channel, message.id, conversation.contact.externalUserId!, body);
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_SENT",
      entity: "Message",
      entityId: message.id,
      ipAddress: req.ip ?? null,
      metadata: { conversationId: conversation.id, contactName: conversation.contact.name, contactPhone: conversation.contact.phone, text: body },
    });
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

// WhatsApp Oficial: whether the 24h customer window is still open and which
// approved templates this conversation's connection can send.
messagesRouter.get(
  "/conversations/:conversationId/template-context",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const conversation = await getConversationOrThrow(req.params.conversationId);
    if (req.auth!.role === "AGENT") await assertAgentCanReadConversation(conversation, req.auth!);
    const context = await templatesService.getTemplateContext(conversation);
    res.json({ ...context, templates: context.templates.map(toMessageTemplateDTO) });
  })
);

const sendTemplateSchema = z.object({
  templateId: z.string().uuid(),
  headerParams: z.array(z.string().trim().min(1).max(60)).max(1).default([]),
  bodyParams: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
});
messagesRouter.post(
  "/conversations/:conversationId/template",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    const { templateId, headerParams, bodyParams } = sendTemplateSchema.parse(req.body);
    const template = await templatesService.getTemplate(templateId);
    if (template.status !== "APPROVED" || template.whatsappConnectionId !== conversation.whatsappConnectionId) {
      throw Errors.badRequest("Este template não está aprovado para a conexão desta conversa");
    }
    if (headerParams.length !== templatesService.templateParamCount(template.headerType === "TEXT" ? template.headerText : null)) {
      throw Errors.badRequest("Preencha todos os campos do cabeçalho do template");
    }
    if (bodyParams.length !== templatesService.templateParamCount(template.bodyText)) {
      throw Errors.badRequest("Preencha todos os campos do texto do template");
    }

    const text = templatesService.renderTemplateText(template, headerParams, bodyParams);
    const message = await service.createOutboundMessage({ conversationId: conversation.id, agentId: req.auth!.userId, type: "TEXT", body: text });
    const headerMedia =
      template.headerSampleStorageKey && template.headerSampleMimeType && ["IMAGE", "VIDEO", "DOCUMENT"].includes(template.headerType)
        ? {
            kind: template.headerType.toLowerCase() as "image" | "video" | "document",
            buffer: fs.readFileSync(path.join(env.UPLOAD_DIR, template.headerSampleStorageKey)),
            fileName: template.headerSampleFileName ?? "arquivo",
            mimeType: template.headerSampleMimeType,
          }
        : undefined;
    const dto = await whatsappService.sendOutboundTemplate(conversation.whatsappConnectionId!, message.id, conversation.contact.phone!, {
      name: template.name,
      language: template.language,
      headerParams,
      headerMedia,
      bodyParams,
    });
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_TEMPLATE_SENT",
      entity: "Message",
      entityId: message.id,
      ipAddress: req.ip ?? null,
      metadata: { conversationId: conversation.id, template: template.name },
    });
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

messagesRouter.post(
  "/conversations/:conversationId/file",
  requireAttendanceAccess,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    assertWhatsAppChannel(conversation, "Envio de arquivos");
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
      conversation.whatsappConnectionId!,
      message.id,
      conversation.contact.phone!,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.auth!.displayName,
      (req.body?.caption as string) || undefined
    );
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_SENT",
      entity: "Message",
      entityId: message.id,
      ipAddress: req.ip ?? null,
      metadata: {
        conversationId: conversation.id,
        contactName: conversation.contact.name,
        contactPhone: conversation.contact.phone,
        text: (req.body?.caption as string) || `Arquivo: ${req.file.originalname}`,
      },
    });
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

messagesRouter.post(
  "/conversations/:conversationId/audio",
  // A recorded voice note (the mic button) — distinct from the generic
  // /file route above, which now sends an attached audio file as a
  // regular playable audio message (ptt: false). This one always sends
  // WhatsApp's native PTT voice-note bubble, which only renders correctly
  // for genuine OGG/Opus — never the browser's raw recorder output (see
  // PROMPT: "está chegando no celular do cliente como um arquivo web").
  requireAttendanceAccess,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    assertWhatsAppChannel(conversation, "Envio de áudio");
    if (!req.file) throw Errors.badRequest("Nenhum audio enviado");

    let oggBuffer: Buffer;
    try {
      oggBuffer = await transcodeToOggOpus(req.file.buffer);
    } catch {
      throw Errors.badRequest("Nao foi possivel processar o audio gravado");
    }

    const message = await service.createOutboundMessage({
      conversationId: conversation.id,
      agentId: req.auth!.userId,
      type: "AUDIO",
    });

    const storageKey = `${randomUUID()}.ogg`;
    fs.writeFileSync(path.join(env.UPLOAD_DIR, storageKey), oggBuffer);
    await service.addAttachment(message.id, {
      fileName: "audio.ogg",
      mimeType: "audio/ogg",
      sizeBytes: oggBuffer.length,
      storageKey,
      kind: "AUDIO",
    });

    const dto = await whatsappService.sendOutboundAudio(
      conversation.whatsappConnectionId!,
      message.id,
      conversation.contact.phone!,
      oggBuffer,
      "audio/ogg; codecs=opus"
    );
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_SENT",
      entity: "Message",
      entityId: message.id,
      ipAddress: req.ip ?? null,
      metadata: { conversationId: conversation.id, contactName: conversation.contact.name, contactPhone: conversation.contact.phone, text: "Áudio (nota de voz)" },
    });
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

const locationSchema = z.object({ latitude: z.number(), longitude: z.number() });
messagesRouter.post(
  "/conversations/:conversationId/location",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const conversation = await loadConversationForAgent(req.params.conversationId, req.auth!.userId);
    assertWhatsAppChannel(conversation, "Envio de localização");
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
    const dto = await whatsappService.sendOutboundLocation(conversation.whatsappConnectionId!, message.id, conversation.contact.phone!, latitude, longitude);
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_SENT",
      entity: "Message",
      entityId: message.id,
      ipAddress: req.ip ?? null,
      metadata: { conversationId: conversation.id, contactName: conversation.contact.name, contactPhone: conversation.contact.phone, text: "Localização compartilhada" },
    });
    realtimeEvents.newMessage(conversation.id, req.auth!.userId);
    res.status(201).json(dto);
  })
);

const reactionSchema = z.object({ emoji: z.string().max(8).nullable() });
messagesRouter.post(
  "/:messageId/reaction",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const { emoji } = reactionSchema.parse(req.body);
    const message = await service.getMessageWithConversation(req.params.messageId);
    const conversation = await loadConversationForAgent(message.conversationId, req.auth!.userId);
    const updated = await service.toggleReaction(req.params.messageId, req.auth!.userId, emoji);
    // Reactions only sync to the remote provider for WhatsApp today — the
    // local toggle above still applies either way, it just won't be
    // mirrored back to Instagram/Messenger yet (see assertWhatsAppChannel's
    // doc comment).
    if (message.providerMessageId && conversation.channel === "WHATSAPP") {
      await whatsappService.sendReaction(conversation.whatsappConnectionId!, conversation.contact.phone!, message.providerMessageId, emoji).catch(() => undefined);
    }
    realtimeEvents.messageStatusChanged(conversation.id, conversation.assignedAgentId);
    res.json(toMessageDTO(updated));
  })
);

messagesRouter.delete(
  "/:messageId",
  // ADMIN-only, same restriction level as conversations.routes.ts's
  // /:id/merge — this permanently hides the message from this app's own
  // conversation view. It never touches Baileys/WhatsApp: the customer's
  // WhatsApp app and any other linked device keep the message untouched,
  // per PROMPT: "de forma que nao afete no que esta no APP".
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const message = await service.getMessageWithConversation(req.params.messageId);
    await service.deleteMessage(req.params.messageId, req.auth!.userId);
    await writeAudit({
      userId: req.auth!.userId,
      action: "MESSAGE_DELETED",
      entity: "Message",
      entityId: req.params.messageId,
      ipAddress: req.ip ?? null,
      metadata: {
        conversationId: message.conversationId,
        contactName: message.conversation.contact.name,
        contactPhone: message.conversation.contact.phone,
        text: message.body,
      },
    });
    realtimeEvents.messageDeleted(message.conversationId, req.params.messageId, message.conversation.assignedAgentId);
    res.status(204).end();
  })
);
