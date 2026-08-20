import { EventEmitter } from "node:events";
import * as QRCode from "qrcode";
import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type {
  ConnectOptions,
  ContactInfo,
  DeliveryEvent,
  InboundMessageEvent,
  ReactionEvent,
  SendResult,
  SendTextOptions,
  WhatsAppProvider,
  WhatsAppStatusSnapshot,
} from "./types";

export interface BaileysProviderOptions {
  /** Directory where Baileys persists the multi-device auth/session state. */
  authStateDir: string;
}

/**
 * Real WhatsApp integration built on Baileys (@whiskeysockets/baileys), an
 * open-source implementation of the WhatsApp Web multi-device protocol.
 *
 * Chosen over the official WhatsApp Cloud/Business API because this project
 * needs the *WhatsApp Web-style QR-code pairing* explicitly requested by the
 * product spec, with no per-conversation billing and no Meta Business
 * verification step. Trade-off (documented, not hidden): Baileys is an
 * unofficial client — WhatsApp's Terms of Service technically prohibit
 * unofficial clients, and protocol changes on WhatsApp's side can break the
 * library until it is updated upstream. For a production deployment with a
 * commercial SLA requirement, swap this class for a Cloud API-backed
 * implementation of the same WhatsAppProvider interface — no other module
 * in the codebase needs to change.
 *
 * NOTE: this class talks to WhatsApp's real servers. It cannot be exercised
 * end-to-end inside an offline/sandboxed CI run; use MockWhatsAppProvider
 * for automated tests and local demos, and this class for a real staging
 * device.
 */
export class BaileysWhatsAppProvider implements WhatsAppProvider {
  private emitter = new EventEmitter();
  private socket: WASocket | null = null;
  private status: WhatsAppStatusSnapshot = {
    state: "DISCONNECTED",
    qrCodeDataUrl: null,
    pairingCode: null,
    connectedNumber: null,
    lastConnectedAt: null,
  };
  private logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? "silent" });
  // Populated from Baileys' contacts.upsert/contacts.update events as they
  // arrive (no makeInMemoryStore dependency needed for just this). Backs
  // listContacts() — the phone's address book, used by "start a new conversation".
  private contacts = new Map<string, ContactInfo>();
  private lastConnectOptions: ConnectOptions | undefined;

  constructor(private options: BaileysProviderOptions) {}

  async connect(connectOptions?: ConnectOptions): Promise<void> {
    this.lastConnectOptions = connectOptions;
    this.setStatus({ ...this.status, state: "CONNECTING" });
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authStateDir);

    const socket = makeWASocket({
      auth: state,
      logger: this.logger as any,
      syncFullHistory: false,
      // Pairing-code linking and QR linking are mutually exclusive per
      // Baileys session: suppress the QR event entirely when a phone number
      // was given, since we're about to request a code instead.
      printQRInTerminal: false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    if (connectOptions?.phoneNumber && !state.creds.registered) {
      try {
        const code = await socket.requestPairingCode(connectOptions.phoneNumber.replace(/\D/g, ""));
        this.setStatus({ ...this.status, state: "CODE_PENDING", pairingCode: code });
      } catch (err) {
        this.logger.error({ err }, "failed to request WhatsApp pairing code");
      }
    }

    socket.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && !connectOptions?.phoneNumber) {
        const qrCodeDataUrl = await QRCode.toDataURL(qr);
        this.setStatus({ ...this.status, state: "QR_PENDING", qrCodeDataUrl });
      }

      if (connection === "open") {
        const connectedNumber = socket.user?.id?.split(":")[0] ?? null;
        this.setStatus({
          state: "CONNECTED",
          qrCodeDataUrl: null,
          pairingCode: null,
          connectedNumber,
          lastConnectedAt: new Date(),
        });
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.setStatus({
          state: "DISCONNECTED",
          qrCodeDataUrl: null,
          pairingCode: null,
          connectedNumber: null,
          lastConnectedAt: this.status.lastConnectedAt,
        });
        if (shouldReconnect) {
          await this.connect(this.lastConnectOptions);
        }
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        await this.handleIncomingMessage(message);
      }
    });

    socket.ev.on("contacts.upsert", (contacts) => this.upsertContacts(contacts));
    socket.ev.on("contacts.update", (contacts) => this.upsertContacts(contacts));

    socket.ev.on("messages.update", (updates) => {
      for (const update of updates) {
        const receipt = (update.update as any)?.status;
        if (!receipt) continue;
        const status = mapBaileysReceiptToStatus(receipt);
        if (!status) continue;
        this.emitter.emit("delivery", {
          providerMessageId: update.key.id ?? "",
          chatId: update.key.remoteJid ?? "",
          status,
          timestamp: new Date(),
        } satisfies DeliveryEvent);
      }
    });

    socket.ev.on("messages.reaction", (reactions) => {
      for (const r of reactions) {
        this.emitter.emit("reaction", {
          providerMessageId: r.key.id ?? "",
          chatId: r.key.remoteJid ?? "",
          emoji: r.reaction.text || null,
          fromPhone: (r.reaction.key?.remoteJid ?? "").split("@")[0],
          timestamp: new Date(),
        } satisfies ReactionEvent);
      }
    });
  }

  async disconnect(): Promise<void> {
    await this.socket?.logout().catch(() => undefined);
    this.socket = null;
    this.contacts.clear();
    this.setStatus({
      state: "DISCONNECTED",
      qrCodeDataUrl: null,
      pairingCode: null,
      connectedNumber: null,
      lastConnectedAt: this.status.lastConnectedAt,
    });
  }

  getStatus(): WhatsAppStatusSnapshot {
    return this.status;
  }

  async sendText(chatId: string, text: string, options?: SendTextOptions): Promise<SendResult> {
    const socket = this.requireSocket();
    const quoted = options?.replyToProviderMessageId
      ? { key: { id: options.replyToProviderMessageId, remoteJid: chatId, fromMe: false } }
      : undefined;
    const sent = await socket.sendMessage(chatId, { text }, { quoted: quoted as any });
    return { providerMessageId: sent?.key.id ?? "", timestamp: new Date() };
  }

  async sendFile(
    chatId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string
  ): Promise<SendResult> {
    const socket = this.requireSocket();
    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    const payload = isImage
      ? { image: buffer, caption, mimetype: mimeType }
      : isVideo
        ? { video: buffer, caption, mimetype: mimeType }
        : { document: buffer, fileName, mimetype: mimeType, caption };
    const sent = await socket.sendMessage(chatId, payload as any);
    return { providerMessageId: sent?.key.id ?? "", timestamp: new Date() };
  }

  async sendAudio(chatId: string, buffer: Buffer, mimeType: string): Promise<SendResult> {
    const socket = this.requireSocket();
    const sent = await socket.sendMessage(chatId, {
      audio: buffer,
      mimetype: mimeType,
      ptt: true,
    });
    return { providerMessageId: sent?.key.id ?? "", timestamp: new Date() };
  }

  async sendLocation(chatId: string, latitude: number, longitude: number): Promise<SendResult> {
    const socket = this.requireSocket();
    const sent = await socket.sendMessage(chatId, { location: { degreesLatitude: latitude, degreesLongitude: longitude } });
    return { providerMessageId: sent?.key.id ?? "", timestamp: new Date() };
  }

  async sendContact(chatId: string, vcard: string, displayName: string): Promise<SendResult> {
    const socket = this.requireSocket();
    const sent = await socket.sendMessage(chatId, {
      contacts: { displayName, contacts: [{ vcard }] },
    });
    return { providerMessageId: sent?.key.id ?? "", timestamp: new Date() };
  }

  async sendReaction(chatId: string, providerMessageId: string, emoji: string | null): Promise<void> {
    const socket = this.requireSocket();
    await socket.sendMessage(chatId, {
      react: { text: emoji ?? "", key: { id: providerMessageId, remoteJid: chatId, fromMe: false } },
    });
  }

  async getContactInfo(chatId: string): Promise<ContactInfo> {
    this.requireSocket();
    return {
      phone: chatId.split("@")[0],
      name: null,
      photoUrl: await this.getContactPhoto(chatId),
    };
  }

  async getContactPhoto(chatId: string): Promise<string | null> {
    const socket = this.requireSocket();
    try {
      return (await socket.profilePictureUrl(chatId, "image")) ?? null;
    } catch {
      return null;
    }
  }

  async listContacts(): Promise<ContactInfo[]> {
    return Array.from(this.contacts.values());
  }

  async syncHistory(): Promise<void> {
    // Baileys can sync history via syncFullHistory during pairing; on-demand
    // backfill for an already-linked session is intentionally not enabled
    // by default (large payloads, WhatsApp rate limits). Documented as a
    // roadmap item — see docs/whatsapp-integration.md.
  }

  onConnectionUpdate(listener: (status: WhatsAppStatusSnapshot) => void): void {
    this.emitter.on("connection", listener);
  }

  onMessage(listener: (event: InboundMessageEvent) => void): void {
    this.emitter.on("message", listener);
  }

  onDelivery(listener: (event: DeliveryEvent) => void): void {
    this.emitter.on("delivery", listener);
  }

  onReaction(listener: (event: ReactionEvent) => void): void {
    this.emitter.on("reaction", listener);
  }

  private requireSocket(): WASocket {
    if (!this.socket || this.status.state !== "CONNECTED") {
      throw new Error("WhatsApp provider is not connected");
    }
    return this.socket;
  }

  private setStatus(status: WhatsAppStatusSnapshot) {
    this.status = status;
    this.emitter.emit("connection", status);
  }

  private upsertContacts(contacts: Array<{ id?: string; name?: string | null; notify?: string | null; imgUrl?: string | null }>) {
    for (const c of contacts) {
      if (!c.id || isNonCustomerChat(c.id)) continue;
      const phone = c.id.split("@")[0];
      const existing = this.contacts.get(phone);
      this.contacts.set(phone, {
        phone,
        name: c.name ?? c.notify ?? existing?.name ?? null,
        photoUrl: (c.imgUrl && c.imgUrl !== "changed" ? c.imgUrl : existing?.photoUrl) ?? null,
      });
    }
  }

  private async handleIncomingMessage(message: WAMessage): Promise<void> {
    if (message.key.fromMe) return;
    const chatId = message.key.remoteJid ?? "";
    if (!chatId || isNonCustomerChat(chatId)) return; // ignore groups, status updates, broadcast lists, channels

    const content = message.message;
    if (!content) return;

    const base = {
      providerMessageId: message.key.id ?? "",
      chatId,
      phone: chatId.split("@")[0],
      contactName: message.pushName ?? null,
      replyToProviderMessageId:
        content.extendedTextMessage?.contextInfo?.stanzaId ?? null,
      timestamp: new Date((Number(message.messageTimestamp) || Date.now() / 1000) * 1000),
    };

    if (content.conversation || content.extendedTextMessage?.text) {
      this.emitter.emit("message", {
        ...base,
        type: "TEXT",
        body: content.conversation ?? content.extendedTextMessage?.text ?? "",
      } satisfies InboundMessageEvent);
      return;
    }

    if (content.locationMessage) {
      this.emitter.emit("message", {
        ...base,
        type: "LOCATION",
        body: null,
        latitude: content.locationMessage.degreesLatitude ?? undefined,
        longitude: content.locationMessage.degreesLongitude ?? undefined,
      } satisfies InboundMessageEvent);
      return;
    }

    if (content.contactMessage) {
      this.emitter.emit("message", {
        ...base,
        type: "CONTACT",
        body: null,
        vcard: content.contactMessage.vcard ?? undefined,
      } satisfies InboundMessageEvent);
      return;
    }

    const mediaType = content.imageMessage
      ? "IMAGE"
      : content.videoMessage
        ? "VIDEO"
        : content.audioMessage
          ? "AUDIO"
          : content.documentMessage
            ? "DOCUMENT"
            : null;

    if (mediaType) {
      try {
        const buffer = (await downloadMediaMessage(message, "buffer", {})) as Buffer;
        const mediaMsg =
          content.imageMessage ?? content.videoMessage ?? content.audioMessage ?? content.documentMessage;
        this.emitter.emit("message", {
          ...base,
          type: mediaType,
          body: (content.imageMessage?.caption || content.videoMessage?.caption) ?? null,
          mediaBuffer: buffer,
          mediaMimeType: mediaMsg?.mimetype ?? "application/octet-stream",
          mediaFileName: (content.documentMessage as any)?.fileName ?? undefined,
        } satisfies InboundMessageEvent);
      } catch (err) {
        this.logger.error({ err }, "failed to download inbound media");
      }
    }
  }
}

/**
 * The queue must only ever contain 1:1 conversations with real customers.
 * WhatsApp's JID suffix tells us the chat's kind: "@g.us" is a group,
 * "@broadcast" covers both Status/Stories updates (chatId === "status@broadcast")
 * and broadcast lists, and "@newsletter" is a channel — none of these are a
 * customer waiting for an agent, so they must never reach findOrCreateContact.
 */
function isNonCustomerChat(chatId: string): boolean {
  return chatId.endsWith("@g.us") || chatId.endsWith("@broadcast") || chatId.endsWith("@newsletter");
}

function mapBaileysReceiptToStatus(receipt: number): DeliveryEvent["status"] | null {
  // Baileys WAMessageStatus enum: 0 ERROR,1 PENDING,2 SERVER_ACK,3 DELIVERY_ACK,4 READ,5 PLAYED
  switch (receipt) {
    case 3:
      return "DELIVERED";
    case 4:
    case 5:
      return "READ";
    case 0:
      return "FAILED";
    default:
      return null;
  }
}
