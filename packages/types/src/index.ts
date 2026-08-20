// Shared types/DTOs used by both apps/api and apps/web.
// Keep this package framework-agnostic (no Express/React/Prisma imports).

export const ROLE = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  AGENT: "AGENT",
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const AGENT_PRESENCE = {
  ONLINE: "ONLINE",
  AWAY: "AWAY",
  OFFLINE: "OFFLINE",
} as const;
export type AgentPresence = (typeof AGENT_PRESENCE)[keyof typeof AGENT_PRESENCE];

// Conversation state machine — see docs/business-rules.md for transitions.
export const CONVERSATION_STATUS = {
  NEW: "NEW",
  WAITING: "WAITING",
  IN_PROGRESS: "IN_PROGRESS",
  TRANSFERRED: "TRANSFERRED",
  CLOSED: "CLOSED",
  ABANDONED: "ABANDONED",
} as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const MESSAGE_DIRECTION = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type MessageDirection = (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

export const MESSAGE_TYPE = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
  DOCUMENT: "DOCUMENT",
  LOCATION: "LOCATION",
  CONTACT: "CONTACT",
  SYSTEM: "SYSTEM",
} as const;
export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export const MESSAGE_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
} as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const WHATSAPP_CONNECTION_STATUS = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  QR_PENDING: "QR_PENDING",
  CODE_PENDING: "CODE_PENDING",
  CONNECTED: "CONNECTED",
} as const;
export type WhatsAppConnectionStatus =
  (typeof WHATSAPP_CONNECTION_STATUS)[keyof typeof WHATSAPP_CONNECTION_STATUS];

export interface UserDTO {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  role: Role;
  status: UserStatus;
  presence: AgentPresence;
  whatsappConnectionId: string | null;
  whatsappConnectionName: string | null;
  createdAt: string;
  lastAccessAt: string | null;
}

export interface WhatsAppConnectionSummaryDTO {
  id: string;
  name: string;
  color: string;
  state: WhatsAppConnectionStatus;
  qrCodeDataUrl: string | null;
  pairingCode: string | null;
  connectedNumber: string | null;
  lastConnectedAt: string | null;
  agentCount: number;
}

/** A contact saved on the connection's linked phone — used by "start a new conversation". */
export interface WhatsAppDeviceContactDTO {
  phone: string;
  name: string | null;
  photoUrl: string | null;
}

export interface ContactDTO {
  id: string;
  phone: string;
  name: string | null;
  photoUrl: string | null;
  firstConversationAt: string;
  lastInteractionAt: string;
}

export interface ConversationListItemDTO {
  id: string;
  contact: ContactDTO;
  status: ConversationStatus;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  whatsappConnectionId: string;
  whatsappConnectionName: string;
  whatsappConnectionColor: string;
  enteredQueueAt: string;
  acceptedAt: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null; // omitted entirely by API while WAITING
  unreadCount: number;
  isNew: boolean;
  pendingTransferDeadline: string | null;
  transfer: {
    fromAgentName: string;
    toAgentName: string;
    at: string;
    note: string | null;
  } | null;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  body: string | null;
  senderAgentDisplayName: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  replyToMessageId: string | null;
  attachments: MessageAttachmentDTO[];
  reactions: MessageReactionDTO[];
}

export interface MessageAttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  kind: MessageType;
  latitude?: number;
  longitude?: number;
  vcard?: string;
}

export interface MessageReactionDTO {
  id: string;
  emoji: string;
  userId: string;
  userDisplayName: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface DashboardFilter {
  period: "today" | "yesterday" | "last7days" | "month" | "lastMonth" | "custom";
  from?: string;
  to?: string;
  agentId?: string | "all";
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
