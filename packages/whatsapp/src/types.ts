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
