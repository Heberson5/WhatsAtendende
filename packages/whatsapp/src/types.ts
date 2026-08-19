export type WhatsAppConnectionState = "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CONNECTED";

export interface WhatsAppStatusSnapshot {
  state: WhatsAppConnectionState;
  qrCodeDataUrl: string | null;
  connectedNumber: string | null;
  lastConnectedAt: Date | null;
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

/**
 * WhatsAppProvider is the single seam between the application and any
 * concrete WhatsApp client library. No other module in the app should
 * import a provider implementation directly — only this interface.
 * Swapping providers (e.g. Baileys -> Cloud API) means writing a new
 * class that implements this interface; nothing else changes.
 */
export interface WhatsAppProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): WhatsAppStatusSnapshot;

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
  syncHistory(chatId: string, limit: number): Promise<void>;

  onConnectionUpdate(listener: (status: WhatsAppStatusSnapshot) => void): void;
  onMessage(listener: (event: InboundMessageEvent) => void): void;
  onDelivery(listener: (event: DeliveryEvent) => void): void;
  onReaction(listener: (event: ReactionEvent) => void): void;
}
