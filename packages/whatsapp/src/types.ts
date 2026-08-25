export type WhatsAppConnectionState = "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CODE_PENDING" | "CONNECTED";

export interface WhatsAppStatusSnapshot {
  state: WhatsAppConnectionState;
  qrCodeDataUrl: string | null;
  // Set only while state === "CODE_PENDING" — the WhatsApp-Web-style linking
  // code the operator types into Settings > Linked Devices > Link with phone
  // number, as an alternative to scanning a QR code.
  pairingCode: string | null;
  connectedNumber: string | null;
  lastConnectedAt: Date | null;
}

export interface ConnectOptions {
  /** When set, requests a pairing code for this phone number instead of a QR code. */
  phoneNumber?: string;
}

export interface InboundMessageEvent {
  providerMessageId: string;
  chatId: string; // provider-native chat/contact id (e.g. "5511999999999@s.whatsapp.net")
  phone: string; // normalized E.164-ish digits
  contactName: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "LOCATION" | "CONTACT";
  body: string | null;
  mediaBuffer?: Buffer;
  mediaMimeType?: string;
  mediaFileName?: string;
  latitude?: number;
  longitude?: number;
  vcard?: string;
  replyToProviderMessageId?: string | null;
  timestamp: Date;
  // true when this message was sent BY the connected account rather than
  // received from the customer — WhatsApp's multi-device protocol reports
  // this the same way whether it was sent through this app or directly
  // from the linked phone (or any other linked session). A message this
  // app itself just sent also echoes back through here; the consumer is
  // responsible for recognizing (by providerMessageId) that it already
  // recorded that one and skipping it, rather than filtering fromMe out
  // entirely — that would silently drop every message sent from the phone.
  fromMe: boolean;
}

export interface DeliveryEvent {
  providerMessageId: string;
  chatId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
}

export interface ReactionEvent {
  providerMessageId: string;
  chatId: string;
  emoji: string | null; // null = reaction removed
  fromPhone: string;
  timestamp: Date;
}

export interface SendResult {
  providerMessageId: string;
  timestamp: Date;
}

export interface SendTextOptions {
  replyToProviderMessageId?: string;
  // The original message's own text — WhatsApp's protocol requires the
  // quoted message's content alongside its key (not just the key) to
  // render the reply-preview bubble; without it Baileys throws building
  // the outgoing stanza and the reply never reaches WhatsApp at all. Only
  // text sends can be a reply (see the /messages/.../text route), so this
  // is always the replied-to message's plain body.
  replyToText?: string | null;
}

export interface ContactInfo {
  phone: string;
  name: string | null;
  photoUrl: string | null;
}

export interface HistoryMessageEvent {
  providerMessageId: string;
  chatId: string;
  phone: string;
  /** true = sent by the connected number itself (e.g. from the phone, before this system was tracking it); false = from the customer. */
  fromMe: boolean;
  type: "TEXT" | "LOCATION" | "CONTACT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  body: string | null;
  latitude?: number;
  longitude?: number;
  vcard?: string;
  timestamp: Date;
}

export interface HistorySyncEvent {
  contacts: ContactInfo[];
  messages: HistoryMessageEvent[];
}

/**
 * Fired when a chat is marked read from somewhere other than this app —
 * almost always the linked phone itself, via WhatsApp's own multi-device
 * sync. Lets the unread badge here match what the agent already sees on
 * their phone instead of only ever clearing when they open it in this UI.
 */
export interface ChatReadEvent {
  chatId: string;
  phone: string; // normalized E.164-ish digits — see phoneFromJid in BaileysWhatsAppProvider
}

/**
 * WhatsAppProvider is the single seam between the application and any
 * concrete WhatsApp client library. No other module in the app should
 * import a provider implementation directly — only this interface.
 * Swapping providers (e.g. Baileys -> Cloud API) means writing a new
 * class that implements this interface; nothing else changes.
 */
export interface WhatsAppProvider {
  connect(options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Cleanly closes the live connection for a graceful process shutdown
   * (e.g. a deploy) WITHOUT touching the persisted session on disk and
   * WITHOUT transitioning status to DISCONNECTED — unlike disconnect(),
   * which unlinks the account entirely. The next process boot's
   * initWhatsAppConnections() only auto-reconnects a row still recorded
   * as CONNECTED, so this must never persist a status change. Letting the
   * WebSocket instead die from the OS killing the process (no close
   * handshake) is what used to leave WhatsApp's own multi-device sync
   * between this companion session and the primary phone corrupted after
   * every deploy — messages still reached the customer fine, but the
   * phone's own chat history got stuck showing "Aguardando mensagem" for
   * them, and the operator had to manually reconnect (fresh QR/code) to
   * clear it.
   */
  endForShutdown(): Promise<void>;
  getStatus(): WhatsAppStatusSnapshot;

  /** Contacts saved on the linked phone — powers "start a new conversation" from Atendimento. Empty while not CONNECTED. */
  listContacts(): Promise<ContactInfo[]>;

  sendText(chatId: string, text: string, options?: SendTextOptions): Promise<SendResult>;
  sendFile(
    chatId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string
  ): Promise<SendResult>;
  sendAudio(chatId: string, buffer: Buffer, mimeType: string): Promise<SendResult>;
  sendLocation(chatId: string, latitude: number, longitude: number): Promise<SendResult>;
  sendContact(chatId: string, vcard: string, displayName: string): Promise<SendResult>;
  sendReaction(chatId: string, providerMessageId: string, emoji: string | null): Promise<void>;

  /**
   * Sends WhatsApp read receipts for the given inbound messages — the same
   * protocol action that (a) shows the customer blue double-check ticks
   * (unless the connected account's own WhatsApp privacy settings have read
   * receipts turned off, in which case WhatsApp itself only syncs step (b)
   * and skips the customer-visible receipt) and (b) clears the unread
   * indicator on every other device linked to this account, including the
   * phone itself. There is no way to request only one of the two — it's a
   * single underlying receipt.
   */
  markRead(chatId: string, providerMessageIds: string[]): Promise<void>;

  getContactInfo(chatId: string): Promise<ContactInfo>;
  getContactPhoto(chatId: string): Promise<string | null>;

  onConnectionUpdate(listener: (status: WhatsAppStatusSnapshot) => void): void;
  onMessage(listener: (event: InboundMessageEvent) => void): void;
  onDelivery(listener: (event: DeliveryEvent) => void): void;
  onReaction(listener: (event: ReactionEvent) => void): void;
  /** Fired when the linked phone hands over its address book and/or recent chat history — see BaileysWhatsAppProvider for when/why this fires. */
  onHistorySync(listener: (event: HistorySyncEvent) => void): void;
  /** Fired when a chat's unread count drops to zero from outside this app (e.g. read on the linked phone) — see ChatReadEvent. */
  onChatRead(listener: (event: ChatReadEvent) => void): void;
}
