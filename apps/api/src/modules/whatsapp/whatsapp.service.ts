import { createWhatsAppProvider, type WhatsAppProvider, type WhatsAppStatusSnapshot } from "@whatsatendende/whatsapp";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { realtimeEvents } from "../../realtime/realtime";
import * as conversationsService from "../conversations/conversations.service";
import * as messagesService from "../messages/messages.service";
import { toMessageDTO } from "../messages/messages.mapper";

let provider: WhatsAppProvider | null = null;

export function getProvider(): WhatsAppProvider {
  if (!provider) throw new Error("WhatsApp provider not initialized");
  return provider;
}

function toChatId(phone: string): string {
  return phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
}

/** Wires the abstract WhatsAppProvider to the rest of the app. Called once at boot — see server.ts. */
export async function initWhatsAppProvider(): Promise<void> {
  provider = createWhatsAppProvider({ provider: env.WHATSAPP_PROVIDER, authStateDir: env.WHATSAPP_AUTH_DIR });

  provider.onConnectionUpdate(async (status) => {
    await persistConnectionStatus(status);
    realtimeEvents.whatsappStatusChanged(status);
  });

  provider.onMessage(async (event) => {
    try {
      const contact = await conversationsService.findOrCreateContact(event.phone, event.contactName);
      const { conversation, isNewConversation } = await conversationsService.findOrOpenConversationForInboundMessage(contact.id);

      const message = await messagesService.createInboundMessage({
        conversationId: conversation.id,
        providerMessageId: event.providerMessageId,
        type: event.type,
        body: event.body,
        replyToProviderMessageId: event.replyToProviderMessageId,
      });

      if (event.mediaBuffer) {
        // Real media persistence (disk/object storage) is wired the same
        // way as agent-uploaded attachments — see messages.routes upload
        // handler. Kept out of the hot inbound path here to avoid blocking
        // on disk I/O inside the provider event callback; a background
        // worker persists it and updates the attachment row (see docs).
        logger.info({ messageId: message.id }, "inbound media received, persisting asynchronously");
      }
      if (event.latitude && event.longitude) {
        await messagesService.addAttachment(message.id, {
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
        await messagesService.addAttachment(message.id, {
          fileName: "contact.vcf",
          mimeType: "text/vcard",
          sizeBytes: event.vcard.length,
          storageKey: "",
          kind: "CONTACT",
          vcard: event.vcard,
        });
      }

      const contactLabel = contact.name ?? contact.phone;
      if (isNewConversation) {
        realtimeEvents.newQueueConversation(conversation.id, contactLabel);
      } else {
        realtimeEvents.newMessage(conversation.id, conversation.assignedAgentId);
        if (conversation.assignedAgentId) {
          const preview = event.body ?? (event.type === "LOCATION" ? "Localizacao" : event.type === "CONTACT" ? "Contato" : "Anexo recebido");
          realtimeEvents.inboundMessageNotification(conversation.id, conversation.assignedAgentId, contactLabel, preview);
        }
      }
    } catch (err) {
      logger.error({ err }, "failed to process inbound whatsapp message");
    }
  });

  provider.onDelivery(async (event) => {
    const message = await messagesService.updateMessageStatusByProviderId(event.providerMessageId, event.status);
    if (message) realtimeEvents.messageStatusChanged(message.conversationId);
  });

  provider.onReaction(async (event) => {
    const message = await prisma.message.findUnique({ where: { providerMessageId: event.providerMessageId } });
    if (!message) return;
    // Customer reactions have userId=NULL, so a compound-unique upsert
    // can't target them reliably (NULLs never compare equal in Postgres) —
    // replace-by-delete instead.
    await prisma.messageReaction.deleteMany({ where: { messageId: message.id, fromCustomer: true } });
    if (event.emoji) {
      await prisma.messageReaction.create({ data: { messageId: message.id, emoji: event.emoji, fromCustomer: true } });
    }
    realtimeEvents.messageStatusChanged(message.conversationId);
  });
}

async function persistConnectionStatus(status: WhatsAppStatusSnapshot) {
  const existing = await prisma.whatsAppConnection.findFirst();
  const data = {
    status: status.state,
    connectedNumber: status.connectedNumber,
    lastConnectedAt: status.lastConnectedAt,
    lastQrAt: status.qrCodeDataUrl ? new Date() : undefined,
  };
  if (existing) {
    await prisma.whatsAppConnection.update({ where: { id: existing.id }, data });
  } else {
    await prisma.whatsAppConnection.create({ data });
  }
}

export async function getConnectionStatus() {
  const status = getProvider().getStatus();
  const record = await prisma.whatsAppConnection.findFirst();
  return {
    state: status.state,
    qrCodeDataUrl: status.qrCodeDataUrl,
    connectedNumber: status.connectedNumber,
    lastConnectedAt: (status.lastConnectedAt ?? record?.lastConnectedAt ?? null)?.toISOString?.() ?? null,
  };
}

export async function connect() {
  await getProvider().connect();
}

export async function disconnect() {
  await getProvider().disconnect();
}

/** Sends a text/reply through the provider and reflects the result on the stored Message row. */
export async function sendOutboundText(
  messageId: string,
  contactPhone: string,
  text: string,
  replyToProviderMessageId?: string
) {
  try {
    const result = await getProvider().sendText(toChatId(contactPhone), text, { replyToProviderMessageId });
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp text");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendOutboundFile(
  messageId: string,
  contactPhone: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string
) {
  try {
    const result = await getProvider().sendFile(toChatId(contactPhone), buffer, fileName, mimeType, caption);
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp file");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendOutboundLocation(messageId: string, contactPhone: string, lat: number, lng: number) {
  try {
    const result = await getProvider().sendLocation(toChatId(contactPhone), lat, lng);
    const message = await messagesService.markMessageSent(messageId, result.providerMessageId);
    return toMessageDTO(message);
  } catch (err) {
    logger.error({ err, messageId }, "failed to send outbound whatsapp location");
    const message = await messagesService.markMessageFailed(messageId);
    return toMessageDTO(message);
  }
}

export async function sendReaction(contactPhone: string, providerMessageId: string, emoji: string | null) {
  await getProvider().sendReaction(toChatId(contactPhone), providerMessageId, emoji);
}
