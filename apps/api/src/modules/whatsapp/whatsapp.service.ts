import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createWhatsAppProvider, type InboundMessageEvent, type WhatsAppProvider, type WhatsAppStatusSnapshot } from "@whatsatendende/whatsapp";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { Errors } from "../../lib/http-error";
import { realtimeEvents } from "../../realtime/realtime";
import * as conversationsService from "../conversations/conversations.service";
import * as messagesService from "../messages/messages.service";
import { toMessageDTO } from "../messages/messages.mapper";

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const MEDIA_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
};

function extensionFor(mimeType: string, fileName?: string): string {
  if (fileName && path.extname(fileName)) return path.extname(fileName);
  return MEDIA_EXT_BY_MIME[mimeType] ?? "";
}

// One WhatsAppProvider instance per named connection (see PROMPT: "poderá
// conectar vários WhatsApp"). Each instance owns its own session/QR/status
// independently — nothing here assumes there's only one.
const providers = new Map<string, WhatsAppProvider>();

function getProvider(connectionId: string): WhatsAppProvider {
  const provider = providers.get(connectionId);
  if (!provider) throw Errors.notFound("Conexao de WhatsApp nao encontrada ou nao inicializada");
  return provider;
}

/** Test-only escape hatch to reach the live provider instance (e.g. to inspect MockWhatsAppProvider.sentTexts) — never used by application code. */
export function __getProviderForTests(connectionId: string): WhatsAppProvider | undefined {
  return providers.get(connectionId);
}

function toChatId(phone: string): string {
  return phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
}

// Multiple agents share the same connected WhatsApp number, so without this
// the customer has no way to tell who they're talking to from one message
// to the next — WhatsApp's own bold markdown (*text*) renders on the phone.
// Only ever applied to the text actually sent over the wire; the stored
// Message.body keeps exactly what the agent typed.
export function withSenderPrefix(senderDisplayName: string, text: string): string {
  return `*${senderDisplayName}:*\n${text}`;
}

/**
 * Boots a provider instance for every existing connection row. Called once
 * at startup — see server.ts.
 *
 * A row whose last persisted status was CONNECTED is auto-reconnected here
 * using its already-linked Baileys session (no new QR/pairing-code needed —
 * WhatsApp accepts the existing credentials same as any other reconnect).
 * Without this, every API restart (every deploy) silently left every
 * previously-connected WhatsApp session sitting idle — the process only
 * ever *creates* the provider object, it never called .connect() on its
 * own — so sending/receiving stayed dead until an admin happened to notice
 * and click "Reconectar" in Configurações.
 */
export async function initWhatsAppConnections(): Promise<void> {
  const rows = await prisma.whatsAppConnection.findMany();
  for (const row of rows) {
    const provider = bootstrapConnection(row.id);
    if (row.status === "CONNECTED") {
      provider.connect().catch((err) => logger.error({ err, connectionId: row.id }, "failed to auto-reconnect WhatsApp connection on startup"));
    }
  }
}

function bootstrapConnection(connectionId: string): WhatsAppProvider {
  const provider = createWhatsAppProvider({
    provider: env.WHATSAPP_PROVIDER,
    authStateDir: path.join(env.WHATSAPP_AUTH_DIR, connectionId),
  });
  providers.set(connectionId, provider);
  wireProviderEvents(connectionId, provider);
  return provider;
}

function wireProviderEvents(connectionId: string, provider: WhatsAppProvider) {
  provider.onConnectionUpdate(async (status) => {
    try {
      let linkedNumberToSet: string | undefined;
      if (status.state === "CONNECTED" && status.connectedNumber) {
        const existing = await prisma.whatsAppConnection.findUnique({
          where: { id: connectionId },
          select: { linkedNumber: true },
        });
        if (!existing) return; // deleted mid-flight — same as the P2025 guard below
        if (existing.linkedNumber && existing.linkedNumber !== status.connectedNumber) {
          // This connection's history (contacts/conversations/messages)
          // belongs to a specific real-world number — see PROMPT:
          // "reconectar somente no mesmo número que já estava antes".
          // Pairing a different one here would silently start mixing a
          // second person's WhatsApp account into it, so the pairing is
          // undone immediately instead of ever reaching CONNECTED.
          logger.error(
            { connectionId, expected: existing.linkedNumber, got: status.connectedNumber },
            "rejected a WhatsApp pairing: the linked number does not match this connection's original number"
          );
          provider.disconnect().catch(() => undefined);
          realtimeEvents.whatsappPairingRejected(connectionId, existing.linkedNumber, status.connectedNumber);
          return;
        }
        if (!existing.linkedNumber) linkedNumberToSet = status.connectedNumber;
      }
      await persistConnectionStatus(connectionId, status, linkedNumberToSet);
    } catch (err) {
      // The connection row can vanish out from under an in-flight
      // connect/reconnect (deleted by an admin, or — only ever in
      // tests — a database reset); a stale async status update landing
      // afterwards is not an error worth crashing over.
      if ((err as { code?: string }).code !== "P2025") throw err;
      logger.warn({ connectionId }, "dropped a status update for a WhatsApp connection that no longer exists");
      return;
    }
    realtimeEvents.whatsappStatusChanged(connectionId, status);
  });

  provider.onMessage(async (event) => {
    try {
      if (event.fromMe) {
        await handleDeviceSentMessage(event);
        return;
      }

      const contact = await conversationsService.findOrCreateContact(connectionId, event.phone, event.contactName, event.chatId);
      if (!contact.photoUrl) {
        // Fire-and-forget: a WhatsApp profile-picture lookup must never
        // delay showing the message itself. Best-effort — getContactPhoto
        // already swallows its own errors and resolves null.
        provider
          .getContactPhoto(event.chatId)
          .then((photoUrl) => (photoUrl ? conversationsService.updateContactPhoto(contact.id, photoUrl) : undefined))
          .catch(() => undefined);
      }
      const { conversation, isNewConversation } = await conversationsService.findOrOpenConversationForInboundMessage(
        connectionId,
        contact.id
      );

      const message = await messagesService.createInboundMessage({
        conversationId: conversation.id,
        providerMessageId: event.providerMessageId,
        type: event.type,
        body: event.body,
        replyToProviderMessageId: event.replyToProviderMessageId,
      });

      await addAttachmentsFromEvent(message.id, event);

      const contactLabel = contact.name ?? contact.phone;
      if (isNewConversation) {
        realtimeEvents.newQueueConversation(connectionId, conversation.id, contactLabel);
      } else {
        realtimeEvents.newMessage(conversation.id, conversation.assignedAgentId);
        if (conversation.assignedAgentId) {
          const preview = event.body ?? (event.type === "LOCATION" ? "Localizacao" : event.type === "CONTACT" ? "Contato" : "Anexo recebido");
          realtimeEvents.inboundMessageNotification(conversation.id, conversation.assignedAgentId, contactLabel, preview);
        }
      }
    } catch (err) {
      logger.error({ err, connectionId }, "failed to process inbound whatsapp message");
    }
  });

  /**
   * A message sent directly from the linked phone (or any other linked
   * device) instead of through this app. Reuses the same contact/
   * conversation lookup as an inbound customer message — WhatsApp itself
   * doesn't distinguish where a conversation's next message comes from —
   * but records it as OUTBOUND with no agent attached, and skips it
   * entirely when it turns out to be an echo of a message this app just
   * sent itself (see createOutboundMessageFromDevice).
   */
  async function handleDeviceSentMessage(event: InboundMessageEvent) {
    // contactName is never trusted here (see BaileysWhatsAppProvider) and
    // a fromMe message should never seed a brand-new contact's photo from
    // this account's own profile picture, so no getContactPhoto call here.
    const contact = await conversationsService.findOrCreateContact(connectionId, event.phone, null, event.chatId);
    const { conversation } = await conversationsService.findOrOpenConversationForInboundMessage(connectionId, contact.id);

    const message = await messagesService.createOutboundMessageFromDevice({
      conversationId: conversation.id,
      providerMessageId: event.providerMessageId,
      type: event.type,
      body: event.body,
      timestamp: event.timestamp,
      replyToProviderMessageId: event.replyToProviderMessageId,
    });
    if (!message) return; // already recorded via this app's own send flow

    await addAttachmentsFromEvent(message.id, event);
    realtimeEvents.newMessage(conversation.id, conversation.assignedAgentId);
  }

  async function addAttachmentsFromEvent(messageId: string, event: InboundMessageEvent) {
    if (event.mediaBuffer) {
      const mimeType = event.mediaMimeType ?? "application/octet-stream";
      const ext = extensionFor(mimeType, event.mediaFileName);
      const storageKey = `${randomUUID()}${ext}`;
      fs.writeFileSync(path.join(env.UPLOAD_DIR, storageKey), event.mediaBuffer);
      await messagesService.addAttachment(messageId, {
        fileName: event.mediaFileName ?? `arquivo${ext}`,
        mimeType,
        sizeBytes: event.mediaBuffer.length,
        storageKey,
        kind: event.type,
      });
    }
    if (event.latitude && event.longitude) {
      await messagesService.addAttachment(messageId, {
        fileName: "location",
        mimeType: "application/geo+json",
        sizeBytes: 0,
        storageKey: "",
        kind: "LOCATION",
        latitude: event.latitude,
        longitude: event.longitude,
      });
    }
    if (event.vcard) {
      await messagesService.addAttachment(messageId, {
        fileName: "contact.vcf",
        mimeType: "text/vcard",
        sizeBytes: event.vcard.length,
        storageKey: "",
        kind: "CONTACT",
        vcard: event.vcard,
      });
    }
  }

  provider.onDelivery(async (event) => {
    const message = await messagesService.updateMessageStatusByProviderId(event.providerMessageId, event.status);
    if (!message) return;
    const conversation = await prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: { assignedAgentId: true },
    });
    realtimeEvents.messageStatusChanged(message.conversationId, conversation?.assignedAgentId);
  });

  provider.onHistorySync(async (event) => {
    try {
      for (const c of event.contacts) {
        if (!c.photoUrl) continue;
        // Best-effort: only touches contacts we already know about (created
        // by a live message or by this same import) — never creates a
        // Contact row just to hold a photo with no conversation behind it.
        await prisma.contact
          .updateMany({ where: { whatsappConnectionId: connectionId, phone: c.phone, photoUrl: null }, data: { photoUrl: c.photoUrl } })
          .catch(() => undefined);
      }
      if (event.messages.length > 0) {
        await conversationsService.importHistoricalMessages(connectionId, event.messages);
        logger.info({ connectionId, count: event.messages.length }, "imported a WhatsApp history sync batch");
      }
    } catch (err) {
      logger.error({ err, connectionId }, "failed to import WhatsApp history sync batch");
    }
  });

  provider.onChatRead(async (event) => {
    try {
      // Non-customer chats (groups, status, broadcast lists) are already
      // filtered out by the provider before this event is emitted.
      const contact = await prisma.contact.findUnique({
        where: { phone_whatsappConnectionId: { phone: event.phone, whatsappConnectionId: connectionId } },
      });
      if (!contact) return;
      const conversation = await conversationsService.findActiveConversationForContact(contact.id);
      if (!conversation) return;
      await conversationsService.markConversationReadFromDevice(conversation.id);
      realtimeEvents.conversationReadFromDevice(conversation.id, conversation.assignedAgentId);
    } catch (err) {
      logger.error({ err, connectionId }, "failed to sync a chat-read event from the linked phone");
    }
  });

  provider.onReaction(async (event) => {
    const message = await prisma.message.findUnique({
      where: { providerMessageId: event.providerMessageId },
      include: { conversation: { select: { assignedAgentId: true } } },
    });
    if (!message) return;
    // Customer reactions have userId=NULL, so a compound-unique upsert
    // can't target them reliably (NULLs never compare equal in Postgres) —
    // replace-by-delete instead.
    await prisma.messageReaction.deleteMany({ where: { messageId: message.id, fromCustomer: true } });
    if (event.emoji) {
      await prisma.messageReaction.create({ data: { messageId: message.id, emoji: event.emoji, fromCustomer: true } });
    }
    realtimeEvents.messageStatusChanged(message.conversationId, message.conversation.assignedAgentId);
  });
}

async function persistConnectionStatus(connectionId: string, status: WhatsAppStatusSnapshot, linkedNumber?: string) {
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: {
      status: status.state,
      connectedNumber: status.connectedNumber,
      lastConnectedAt: status.lastConnectedAt,
      lastQrAt: status.qrCodeDataUrl || status.pairingCode ? new Date() : undefined,
      ...(linkedNumber ? { linkedNumber } : {}),
    },
  });
}

export interface ConnectionSummaryDTO {
  id: string;
  name: string;
  color: string;
  state: string;
  qrCodeDataUrl: string | null;
  pairingCode: string | null;
  connectedNumber: string | null;
  // The number this connection was first ever linked to — see PROMPT:
  // "reconectar somente no mesmo número que já estava antes". Null only for
  // a connection that has never completed a pairing yet, in which case any
  // number is accepted (there's nothing to conflict with).
  linkedNumber: string | null;
  lastConnectedAt: string | null;
  agentCount: number;
}

// Distinct, readable-on-white swatches auto-assigned to new connections in
// rotation so the admin doesn't have to pick a color for every one — still
// changeable afterwards via PATCH /connections/:id.
const COLOR_PALETTE = ["#0097B4", "#7C3AED", "#F97316", "#059669", "#DC2626", "#2563EB", "#DB2777", "#65A30D"];

function toConnectionSummary(row: {
  id: string;
  name: string;
  color: string;
  status: string;
  connectedNumber: string | null;
  linkedNumber: string | null;
  lastConnectedAt: Date | null;
  _count: { agents: number };
}): ConnectionSummaryDTO {
  const runtime = providers.get(row.id)?.getStatus();
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    state: runtime?.state ?? row.status,
    qrCodeDataUrl: runtime?.qrCodeDataUrl ?? null,
    pairingCode: runtime?.pairingCode ?? null,
    connectedNumber: runtime?.connectedNumber ?? row.connectedNumber,
    linkedNumber: row.linkedNumber,
    lastConnectedAt: (runtime?.lastConnectedAt ?? row.lastConnectedAt)?.toISOString?.() ?? null,
    agentCount: row._count.agents,
  };
}

export async function listConnections(): Promise<ConnectionSummaryDTO[]> {
  const rows = await prisma.whatsAppConnection.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { agents: true } } },
  });
  return rows.map(toConnectionSummary);
}

export async function getConnectionSummary(connectionId: string): Promise<ConnectionSummaryDTO> {
  const row = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    include: { _count: { select: { agents: true } } },
  });
  if (!row) throw Errors.notFound("Conexao de WhatsApp nao encontrada");
  return toConnectionSummary(row);
}

export async function createConnection(name: string, color?: string): Promise<ConnectionSummaryDTO> {
  const existing = await prisma.whatsAppConnection.findUnique({ where: { name } });
  if (existing) throw Errors.conflict("Ja existe uma conexao com este nome");
  const existingCount = await prisma.whatsAppConnection.count();
  const row = await prisma.whatsAppConnection.create({
    data: { name, color: color ?? COLOR_PALETTE[existingCount % COLOR_PALETTE.length] },
  });
  bootstrapConnection(row.id);
  return getConnectionSummary(row.id);
}

export async function updateConnection(connectionId: string, patch: { name?: string; color?: string }): Promise<ConnectionSummaryDTO> {
  if (patch.name) {
    const clash = await prisma.whatsAppConnection.findUnique({ where: { name: patch.name } });
    if (clash && clash.id !== connectionId) throw Errors.conflict("Ja existe uma conexao com este nome");
  }
  await prisma.whatsAppConnection.update({ where: { id: connectionId }, data: { name: patch.name, color: patch.color } });
  return getConnectionSummary(connectionId);
}

export async function deleteConnection(connectionId: string): Promise<void> {
  const agentCount = await prisma.user.count({ where: { whatsappConnectionId: connectionId } });
  if (agentCount > 0) {
    throw Errors.badRequest("Existem atendentes vinculados a esta conexao — reatribua-os antes de excluir");
  }
  // Contacts/conversations/messages keep a foreign key to this connection
  // (ON DELETE RESTRICT — the history must never silently disappear), so a
  // connection that has ever exchanged a message can't actually be deleted.
  // Checked explicitly here so the admin gets a clear message instead of a
  // raw foreign-key-violation 500 from the DELETE below.
  const contactCount = await prisma.contact.count({ where: { whatsappConnectionId: connectionId } });
  if (contactCount > 0) {
    throw Errors.badRequest("Esta conexao tem historico de conversas e não pode ser excluida — o historico é preservado para sempre.");
  }
  const provider = providers.get(connectionId);
  // Only an actually-linked session needs an explicit disconnect first — a
  // stuck/failed pairing attempt (CONNECTING, QR_PENDING, CODE_PENDING) is
  // safe to tear down directly, so a bad pairing attempt (e.g. no outbound
  // network access to WhatsApp's servers) can never permanently block deletion.
  if (provider && provider.getStatus().state === "CONNECTED") {
    throw Errors.badRequest("Desconecte o WhatsApp antes de excluir esta conexao");
  }
  if (provider) {
    await provider.disconnect().catch(() => undefined);
  }
  providers.delete(connectionId);
  await prisma.whatsAppConnection.delete({ where: { id: connectionId } });
}

export async function connect(connectionId: string, phoneNumber?: string) {
  await getProvider(connectionId).connect(phoneNumber ? { phoneNumber } : undefined);
}

export async function disconnect(connectionId: string) {
  await getProvider(connectionId).disconnect();
}

/** Contacts saved on the linked phone — powers "start a new conversation" in Atendimento. */
export async function listContacts(connectionId: string) {
  return getProvider(connectionId).listContacts();
}

/** Sends a text/reply through the provider and reflects the result on the stored Message row. */
export async function sendOutboundText(
  connectionId: string,
  messageId: string,
  contactPhone: string,
  text: string,
  senderDisplayName: string,
  replyToProviderMessageId?: string
) {
  try {
    const result = await getProvider(connectionId).sendText(toChatId(contactPhone), withSenderPrefix(senderDisplayName, text), {
      replyToProviderMessageId,
    });
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp text");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendOutboundFile(
  connectionId: string,
  messageId: string,
  contactPhone: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  senderDisplayName: string,
  caption?: string
) {
  try {
    const result = await getProvider(connectionId).sendFile(
      toChatId(contactPhone),
      buffer,
      fileName,
      mimeType,
      caption ? withSenderPrefix(senderDisplayName, caption) : undefined
    );
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp file");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendOutboundLocation(connectionId: string, messageId: string, contactPhone: string, lat: number, lng: number) {
  try {
    const result = await getProvider(connectionId).sendLocation(toChatId(contactPhone), lat, lng);
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp location");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendReaction(connectionId: string, contactPhone: string, providerMessageId: string, emoji: string | null) {
  await getProvider(connectionId).sendReaction(toChatId(contactPhone), providerMessageId, emoji);
}
