import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
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
  ChatReadEvent,
  ConnectOptions,
  ContactInfo,
  DeliveryEvent,
  HistoryMessageEvent,
  HistorySyncEvent,
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
  // Persists the in-memory contacts Map to a small JSON file next to the
  // Baileys auth state so "Nova conversa"'s address book survives an API
  // process restart (every deploy). Without this, listContacts() came back
  // empty right after every restart — the phone's address book only
  // trickles back in gradually via contacts.upsert/update as live
  // conversations happen (see the syncFullHistory comment in connect()) —
  // which used to look like "Nova Conversa parou de trazer os contatos".
  private contactsCachePath: string;
  private lastConnectOptions: ConnectOptions | undefined;
  // Reconnect bookkeeping — see the "connection: close" handler below for
  // why this exists: without it, a socket that can never actually reach
  // WhatsApp (e.g. outbound network blocked on the host) reconnects in a
  // tight loop forever, and a truly synchronous startup failure left the
  // status stuck at CONNECTING with no way out (not even deletable — see
  // whatsapp.service.ts deleteConnection).
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_INITIAL_PAIRING_RETRIES = 3;
  private static readonly BASE_RECONNECT_DELAY_MS = 3000;
  private static readonly MAX_RECONNECT_DELAY_MS = 30_000;

  constructor(private options: BaileysProviderOptions) {
    this.contactsCachePath = path.join(options.authStateDir, "contacts-cache.json");
    this.loadContactsCache();
  }

  private loadContactsCache() {
    try {
      const raw = fs.readFileSync(this.contactsCachePath, "utf-8");
      const entries = JSON.parse(raw) as ContactInfo[];
      for (const c of entries) this.contacts.set(c.phone, c);
    } catch {
      // No cache yet (first run for this connection) or a corrupt/unreadable
      // file — starts empty, same as before this cache existed.
    }
  }

  private persistContactsCache() {
    try {
      fs.mkdirSync(path.dirname(this.contactsCachePath), { recursive: true });
      fs.writeFileSync(this.contactsCachePath, JSON.stringify(Array.from(this.contacts.values())));
    } catch (err) {
      this.logger.error({ err }, "failed to persist WhatsApp contacts cache to disk");
    }
  }

  async connect(connectOptions?: ConnectOptions): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastConnectOptions = connectOptions;
    this.setStatus({ ...this.status, state: "CONNECTING" });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.options.authStateDir);
      const wasAlreadyLinked = Boolean(state.creds.registered);

      const socket = makeWASocket({
        auth: state,
        logger: this.logger as any,
        // REVERTED to false: turning this on destabilized an already-linked
        // real account (sending/receiving/contacts all broke) — the
        // `requireFullSync` flag Baileys sends the phone only applies at
        // fresh pairing, but this flag *also* gates whether every reconnect
        // processes the phone's history-sync payload (see
        // "messaging-history.set" below), and doing that against a real
        // account's full history apparently jammed the connection badly
        // enough to break basic message delivery. Restoring the known-good
        // default. Contacts still populate gradually via contacts.upsert/
        // contacts.update as real conversations happen (those aren't gated
        // by this flag) — just not as an upfront bulk address-book dump.
        // Re-enabling bulk history/contacts sync needs a much more careful,
        // chunked/rate-limited approach than a blanket flag flip; not
        // attempting that again against a live account blind.
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
          this.settleDisconnected();
          return;
        }
      }

      socket.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr && !connectOptions?.phoneNumber) {
          this.reconnectAttempts = 0;
          const qrCodeDataUrl = await QRCode.toDataURL(qr);
          this.setStatus({ ...this.status, state: "QR_PENDING", qrCodeDataUrl });
        }

        if (connection === "open") {
          this.reconnectAttempts = 0;
          // Prefer the phone-number JID (`jid`) over the raw session id —
          // same @lid privacy migration as everywhere else in this file:
          // `id` can itself be `<lid>:<device>@lid` for an account WhatsApp
          // has moved to a LID-based identity, which used to surface as a
          // meaningless "connected number" and — worse — as a false
          // same-number mismatch on every later reconnect (see
          // whatsapp.service.ts), since it no longer matched the real
          // number recorded the first time this connection was paired.
          const ownIdentity = socket.user?.jid ?? socket.user?.id ?? null;
          const connectedNumber = ownIdentity ? ownIdentity.split(":")[0].split("@")[0] : null;
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
          this.settleDisconnected();

          if (!shouldReconnect) {
            // WhatsApp itself revoked this session (unlinked from the
            // phone's own "Aparelhos conectados", or logged out) — the
            // credentials saved on disk are now permanently dead. Without
            // clearing them, the *next* connect() attempt would keep
            // seeing `state.creds.registered === true` and silently retry
            // this same dead session instead of falling back to a fresh
            // QR/pairing-code flow — which is exactly what used to leave
            // "Conectar" on an existing connection generating nothing at
            // all after a real logout.
            await fs.promises.rm(this.options.authStateDir, { recursive: true, force: true }).catch(() => undefined);
            return; // explicit logout — never auto-retry
          }

          this.reconnectAttempts += 1;
          // A session that was linked before and just dropped (network
          // blip, WhatsApp-side restart) is worth retrying indefinitely
          // with backoff — that's normal operation. A *fresh* pairing
          // attempt that never got past QR/code generation is much more
          // likely a real problem (e.g. no outbound network access to
          // WhatsApp's servers from this host) — retrying that forever
          // just hides the failure and leaves the admin stuck watching
          // "Conectando..." with no explanation, so give up after a few
          // tries and let the connection settle back to DISCONNECTED.
          if (!wasAlreadyLinked && this.reconnectAttempts > BaileysWhatsAppProvider.MAX_INITIAL_PAIRING_RETRIES) {
            this.logger.error(
              "giving up on WhatsApp pairing after repeated failed attempts — check that this host has outbound network access to WhatsApp's servers"
            );
            return;
          }
          const delay = Math.min(
            BaileysWhatsAppProvider.BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
            BaileysWhatsAppProvider.MAX_RECONNECT_DELAY_MS
          );
          this.reconnectTimer = setTimeout(() => {
            this.connect(this.lastConnectOptions).catch((err) => this.logger.error({ err }, "WhatsApp reconnect attempt failed"));
          }, delay);
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

      socket.ev.on("messaging-history.set", ({ contacts, messages }) => {
        this.upsertContacts(contacts);
        const converted: HistoryMessageEvent[] = [];
        for (const message of messages) {
          const chatId = message.key.remoteJid ?? "";
          if (!chatId || isNonCustomerChat(chatId)) continue;
          const entry = convertHistoryMessage(message, chatId);
          if (entry) converted.push(entry);
        }
        if (converted.length > 0 || contacts.length > 0) {
          this.emitter.emit("historySync", {
            contacts: Array.from(this.contacts.values()),
            messages: converted,
          } satisfies HistorySyncEvent);
        }
      });

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

      // Fires whenever WhatsApp's multi-device sync pushes a chat-state
      // change from any linked device — most relevantly, the phone itself
      // marking a chat as read. Only the transition to "no unread messages
      // left" matters here; every other partial update (archived, pinned,
      // muted, etc.) is ignored.
      socket.ev.on("chats.update", (updates) => {
        for (const update of updates) {
          const chatId = update.id;
          if (!chatId || isNonCustomerChat(chatId)) continue;
          if (update.unreadCount === undefined || update.unreadCount === null) continue;
          if (Number(update.unreadCount) > 0) continue;
          this.emitter.emit("chatRead", { chatId, phone: phoneFromJid(chatId, update.pnJid) } satisfies ChatReadEvent);
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
    } catch (err) {
      // A failure before the socket even got a chance to try connecting
      // (e.g. can't write to WHATSAPP_AUTH_DIR) used to leave status stuck
      // at CONNECTING forever, with no error surfaced anywhere the admin
      // could see it, and no way to even delete the connection.
      this.logger.error({ err }, "failed to start WhatsApp connection");
      this.settleDisconnected();
    }
  }

  /** Resets status to DISCONNECTED while preserving lastConnectedAt — shared by every "give up" path in connect(). */
  private settleDisconnected() {
    this.setStatus({
      state: "DISCONNECTED",
      qrCodeDataUrl: null,
      pairingCode: null,
      connectedNumber: null,
      lastConnectedAt: this.status.lastConnectedAt,
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.socket?.logout().catch(() => undefined);
    this.socket = null;
    this.contacts.clear();
    // An explicit disconnect means unlinking — the credentials are dead
    // either way (socket.logout() already told WhatsApp's servers to
    // revoke them when that succeeded; wiping them here too guarantees it
    // regardless, so the next "Conectar" always gets a genuinely fresh
    // QR/pairing-code flow instead of silently retrying a dead session —
    // see the same reasoning in the "connection: close" / loggedOut branch
    // of connect()). A future relink could also be a different phone
    // entirely, so the cached address book must not bleed into it either.
    fs.rmSync(this.options.authStateDir, { recursive: true, force: true });
    fs.rmSync(this.contactsCachePath, { force: true });
    this.settleDisconnected();
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

  onHistorySync(listener: (event: HistorySyncEvent) => void): void {
    this.emitter.on("historySync", listener);
  }

  onChatRead(listener: (event: ChatReadEvent) => void): void {
    this.emitter.on("chatRead", listener);
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

  private upsertContacts(contacts: Array<{ id?: string; jid?: string; name?: string | null; notify?: string | null; imgUrl?: string | null }>) {
    for (const c of contacts) {
      if (!c.id || isNonCustomerChat(c.id)) continue;
      // `id` is `@lid` (an opaque privacy identifier, not a phone number)
      // for a growing share of contacts — Baileys separately hands back the
      // real phone-number JID as `jid` whenever it knows it.
      const phone = (c.jid ?? c.id).split("@")[0];
      const existing = this.contacts.get(phone);
      this.contacts.set(phone, {
        phone,
        name: c.name ?? c.notify ?? existing?.name ?? null,
        photoUrl: (c.imgUrl && c.imgUrl !== "changed" ? c.imgUrl : existing?.photoUrl) ?? null,
      });
    }
    this.persistContactsCache();
  }

  private async handleIncomingMessage(message: WAMessage): Promise<void> {
    // Previously dropped every fromMe message outright to avoid the app
    // double-recording its own sends — but that also silently dropped
    // every message sent directly from the linked phone (or any other
    // linked device), since WhatsApp's protocol marks both cases fromMe
    // identically. The consumer now de-duplicates by providerMessageId
    // instead — see fromMe on InboundMessageEvent.
    const chatId = message.key.remoteJid ?? "";
    if (!chatId || isNonCustomerChat(chatId)) return; // ignore groups, status updates, broadcast lists, channels

    const content = message.message;
    if (!content) return;

    const base = {
      providerMessageId: message.key.id ?? "",
      chatId,
      phone: phoneFromJid(chatId, message.key.senderPn ?? message.key.participantPn),
      // pushName on a fromMe message is this account's own name, not the
      // customer's — never let it overwrite the contact's stored name.
      contactName: message.key.fromMe ? null : (message.pushName ?? null),
      replyToProviderMessageId:
        content.extendedTextMessage?.contextInfo?.stanzaId ?? null,
      timestamp: new Date((Number(message.messageTimestamp) || Date.now() / 1000) * 1000),
      fromMe: Boolean(message.key.fromMe),
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

/**
 * WhatsApp is migrating chats to opaque `@lid` identifiers instead of the
 * phone-number-based `@s.whatsapp.net` JID, for privacy. `jid.split("@")[0]`
 * on a `@lid` JID is a meaningless internal number — not a phone number an
 * agent could recognize, call, or save — which used to show up as "the
 * wrong number" for the contact everywhere in the app. WhatsApp separately
 * hands back the real phone number wherever it's known (a message's
 * senderPn/participantPn, a chat's pnJid, a contact's jid); this picks
 * that up when available, falling back to the LID digits only when
 * WhatsApp hasn't told us the real number for this chat yet.
 */
function phoneFromJid(jid: string, altPnJid?: string | null): string {
  if (!jid.endsWith("@lid") || !altPnJid) return jid.split("@")[0];
  return altPnJid.split("@")[0];
}

/**
 * Converts one WAMessage out of a `messaging-history.set` batch into our
 * HistoryMessageEvent shape. Deliberately does NOT download media: a real
 * business account's history sync can hand back thousands of messages in
 * one batch, and re-downloading every past image/video/audio/document would
 * be slow, rate-limit-risky, and balloon disk usage for content the agent
 * may never need. Media messages are still imported (so the conversation
 * thread and its timeline are complete) but without the attachment binary —
 * MessageBubble shows a "media from before this system tracked it" state
 * for those. Only TEXT/LOCATION/CONTACT (cheap, no binary) carry full content.
 */
function convertHistoryMessage(message: WAMessage, chatId: string): HistoryMessageEvent | null {
  const content = message.message;
  if (!content) return null;

  const base = {
    providerMessageId: message.key.id ?? "",
    chatId,
    phone: phoneFromJid(chatId, message.key.senderPn ?? message.key.participantPn),
    fromMe: Boolean(message.key.fromMe),
    timestamp: new Date((Number(message.messageTimestamp) || Date.now() / 1000) * 1000),
  };
  if (!base.providerMessageId) return null;

  if (content.conversation || content.extendedTextMessage?.text) {
    return { ...base, type: "TEXT", body: content.conversation ?? content.extendedTextMessage?.text ?? "" };
  }
  if (content.locationMessage) {
    return {
      ...base,
      type: "LOCATION",
      body: null,
      latitude: content.locationMessage.degreesLatitude ?? undefined,
      longitude: content.locationMessage.degreesLongitude ?? undefined,
    };
  }
  if (content.contactMessage) {
    return { ...base, type: "CONTACT", body: null, vcard: content.contactMessage.vcard ?? undefined };
  }
  if (content.imageMessage) return { ...base, type: "IMAGE", body: content.imageMessage.caption ?? null };
  if (content.videoMessage) return { ...base, type: "VIDEO", body: content.videoMessage.caption ?? null };
  if (content.audioMessage) return { ...base, type: "AUDIO", body: null };
  if (content.documentMessage) return { ...base, type: "DOCUMENT", body: content.documentMessage.title ?? null };
  return null;
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
