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
  // A still-unassigned conversation was read directly on the linked phone —
  // it leaves the queue without being attributed to any agent.
  HANDLED_EXTERNALLY: "HANDLED_EXTERNALLY",
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
  POLL: "POLL",
  EVENT: "EVENT",
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

// Which messaging channel a conversation/contact belongs to — see PROMPT:
// "prepare tudo para integrar com Instagram e Facebook".
export const CHANNEL = {
  WHATSAPP: "WHATSAPP",
  INSTAGRAM: "INSTAGRAM",
  MESSENGER: "MESSENGER",
} as const;
export type Channel = (typeof CHANNEL)[keyof typeof CHANNEL];

export interface UserDTO {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  role: Role;
  status: UserStatus;
  presence: AgentPresence;
  photoUrl: string | null;
  whatsappConnectionId: string | null;
  whatsappConnectionName: string | null;
  // Live state of whatsappConnectionId's connection — null when the user
  // has no fixed connection (only ever set for AGENT). Powers the "your
  // connection is disconnected" banner in Atendimento.
  whatsappConnectionStatus: WhatsAppConnectionStatus | null;
  createdAt: string;
  lastAccessAt: string | null;
  // Where this user works — drives which STATE/MUNICIPAL holidays block
  // their access automatically. Both null = only NATIONAL holidays (if
  // any) can ever apply to this user.
  workState: string | null;
  workCity: string | null;
  // Per-weekday allowed access window — a day absent/undefined here means
  // unrestricted (24h) for that weekday. null as a whole = every day
  // unrestricted (the common case: no access-hours restriction at all).
  accessSchedule: AccessSchedule | null;
  // Set together — both null unless presence is AWAY from a self-initiated
  // pause (see profile.service.ts's pauseOwnAttendance). Lets any screen
  // that shows "Ausente" show the reason instead.
  pauseReasonId: string | null;
  pauseReasonName: string | null;
  pausedAt: string | null;
  // Custom hour range (0-23) saved as this user's default for the Dashboard's
  // "Presença ao longo do dia" chart — both null means "show every hour".
  presenceChartStartHour: number | null;
  presenceChartEndHour: number | null;
}

// HH:mm, 24h, e.g. "08:00" / "18:30".
export interface AccessScheduleWindow {
  start: string;
  end: string;
}

export const WEEKDAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type AccessSchedule = Partial<Record<WeekdayKey, AccessScheduleWindow>>;

export const HOLIDAY_SCOPE = {
  NATIONAL: "NATIONAL",
  STATE: "STATE",
  MUNICIPAL: "MUNICIPAL",
} as const;
export type HolidayScope = (typeof HOLIDAY_SCOPE)[keyof typeof HOLIDAY_SCOPE];

export const HOLIDAY_SOURCE = {
  MANUAL: "MANUAL",
  AUTO: "AUTO",
} as const;
export type HolidaySource = (typeof HOLIDAY_SOURCE)[keyof typeof HOLIDAY_SOURCE];

export interface HolidayDTO {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  scope: HolidayScope;
  state: string | null;
  city: string | null;
  source: HolidaySource;
  year: number;
}

export interface PauseReasonDTO {
  id: string;
  name: string;
  active: boolean;
}

// Dashboard's "Presença ao longo do dia" chart — one point per hour-of-day
// (0-23), each a count of distinct agent/day occurrences per status seen
// during that hour across the selected period. "counts" keys are "Online"
// plus every pause-reason name that occurred (or "Outros motivos" for an
// AWAY segment whose reason was later deactivated/removed); "series" lists
// those same keys in the order they should be stacked/legended.
export interface PresenceByHourPoint {
  hour: number;
  counts: Record<string, number>;
}

export interface PresenceByHourDTO {
  series: string[];
  hours: PresenceByHourPoint[];
}

export interface QuickReplyDTO {
  id: string;
  name: string;
  /** Without the leading "/" — see the QuickReply Prisma model comment. */
  shortcut: string;
  text: string;
  whatsappConnectionId: string;
  whatsappConnectionName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClosingMessageDTO {
  id: string;
  name: string;
  text: string;
  active: boolean;
  /** Users who get this message auto-sent when they click Encerrar — a user appears in at most one ClosingMessage's list at a time. */
  assignedUsers: { id: string; displayName: string }[];
  createdAt: string;
  updatedAt: string;
}

/** A missed-you-live event surfaced in the Topbar bell — see NotificationBell. entityType/entityId (e.g. "Conversation"/id) drive where clicking it navigates. */
export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export type AutoMessageTrigger = "TRANSFER" | "ACCEPT";

/** Customer-facing notice auto-sent by the system (not an agent) on TRANSFER/ACCEPT — supports {{atendente}}/{{cliente}} tags. See Respostas > Transferência/Aceite. */
export interface AutoMessageTemplateDTO {
  id: string;
  trigger: AutoMessageTrigger;
  name: string;
  text: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
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
  // Who created this connection — a MANAGER always has full access (view/
  // edit/receive) to a connection they created themselves, without needing
  // an explicit grant. Null for a connection created before this field
  // existed, or created directly by an ADMIN acting alone.
  createdByUserId: string | null;
  createdByUserName: string | null;
}

/**
 * One MANAGER's access grant to a connection they did NOT create — set by
 * an ADMIN in Usuários. Two independent flags, matching PROMPT: "designar
 * qual conexão os gestores poderão ver/editar e também poderão receber
 * novas conversas de quais conexões" — a manager can be granted either,
 * both, or neither on any given connection (view/edit access to the
 * connection's own settings vs. eligibility to receive/accept its queue).
 * A connection the manager created themselves needs no row here at all —
 * see WhatsAppConnectionSummaryDTO.createdByUserId.
 */
export interface ManagerConnectionAccessDTO {
  whatsappConnectionId: string;
  whatsappConnectionName: string;
  whatsappConnectionColor: string;
  // true when this manager created the connection themselves — canManage
  // and canReceiveConversations are then always true and not editable
  // (implicit full access, no grant row backing it).
  owned: boolean;
  canManage: boolean;
  canReceiveConversations: boolean;
}

/** A contact saved on the connection's linked phone — used by "start a new conversation". */
export interface WhatsAppDeviceContactDTO {
  phone: string;
  name: string | null;
  photoUrl: string | null;
}

export interface ContactDTO {
  id: string;
  // null when WhatsApp hasn't revealed this contact's real phone number yet
  // (still only known by its opaque @lid privacy id) — see
  // conversations.mapper.ts. Never the meaningless @lid digits: those look
  // like a real number but aren't one an agent could recognize or call.
  phone: string | null;
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
  // Which channel this conversation is on — drives which icon/label
  // ConversationCard shows. WhatsAppConnection*/below stays populated
  // (with the owning MetaConnection's data, not just WhatsApp's) for every
  // channel so existing consumers keep working unchanged; new code should
  // prefer `channel` to decide how to label/icon it.
  channel: Channel;
  whatsappConnectionId: string;
  whatsappConnectionName: string;
  whatsappConnectionColor: string;
  // Live status of the owning connection — DISCONNECTED (or anything short
  // of CONNECTED) blocks accepting/sending on this conversation and drives
  // the disconnected-connection banner in the queue card and chat panel.
  whatsappConnectionStatus: WhatsAppConnectionStatus;
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
  /** Set when this message replies to a WhatsApp Status/Story rather than to another message in the conversation — the story itself is never fetched/stored, only the small preview WhatsApp embeds directly in the reply. Deliberately carries no id/link to navigate to: there is nothing to navigate to. */
  replyToStory: { text: string | null; thumbnailUrl: string | null } | null;
  /** Link-preview card (WhatsApp Web parity) for a TEXT message whose body contains a URL. */
  linkPreview: { title: string; description: string | null; url: string; thumbnailUrl: string | null } | null;
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
  /** POLL only — the poll's question. */
  pollQuestion?: string;
  /** POLL only — the poll's option labels (read-only: votes are end-to-end encrypted and not decoded here). */
  pollOptions?: string[];
  /** EVENT only. */
  eventName?: string;
  eventDescription?: string;
  eventStartAt?: string;
  eventJoinLink?: string;
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

export interface AuditLogDTO {
  id: string;
  userDisplayName: string; // "Sistema" for actions with no acting user (e.g. an automatic transfer revert)
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
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

/** GET/PATCH /settings/maintenance — GET is public (the login screen needs it before authenticating). */
export interface MaintenanceSettingsDTO {
  enabled: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Granular per-role permissions (Configurações > Permissões).
//
// ADMIN is intentionally absent from PERMISSION_DEFINITIONS' editableRoles/
// defaultAllowed: it always has every permission, hardcoded on the backend,
// never stored or toggleable — otherwise an admin could accidentally lock
// themselves (and everyone else) out of the permissions screen itself with
// no way back in. AGENT/MANAGER defaults below reproduce exactly the
// hardcoded role checks this feature replaces, so turning it on changes
// nothing until an admin actually edits a toggle.
// ---------------------------------------------------------------------------

export const PERMISSION = {
  ATENDIMENTO_ACESSAR: "atendimento.acessar",
  ATENDIMENTO_TRANSFERIR: "atendimento.transferir",
  ATENDIMENTO_ENCERRAR: "atendimento.encerrar",
  GESTAO_ACESSAR: "gestao.acessar",
  // Layered ON TOP of GESTAO_ACESSAR (need both) — see that key's own doc
  // comment.
  GESTAO_GERENCIAR: "gestao.gerenciar",
  DASHBOARD_ACESSAR: "dashboard.acessar",
  RELATORIOS_ACESSAR: "relatorios.acessar",
  // Usuários — split from the old single USUARIOS_GERENCIAR into granular
  // visualizar/adicionar/editar/inativar. Hard delete (irreversible) stays
  // ADMIN-only via requireRole, same as before — never part of this matrix.
  // See PROMPT: "na me referi em apenas as pausas, mas sim tudo que é
  // evitável, cadastravel e visualizarem".
  USUARIOS_VISUALIZAR: "usuarios.visualizar",
  USUARIOS_ADICIONAR: "usuarios.adicionar",
  USUARIOS_EDITAR: "usuarios.editar",
  USUARIOS_INATIVAR: "usuarios.inativar",
  CONFIGURACOES_GERENCIAR: "configuracoes.gerenciar",
  // Each layered ON TOP of CONFIGURACOES_GERENCIAR (need both) — see that
  // key's own doc comment. Identidade visual/E-mail/Modelos de e-mail are
  // each a single record to edit (no list to add/remove from), so they only
  // split into visualizar/editar — unlike Feriados, which is a real list.
  CONFIGURACOES_IDENTIDADE_VISUALIZAR: "configuracoes.identidade.visualizar",
  CONFIGURACOES_IDENTIDADE_EDITAR: "configuracoes.identidade.editar",
  CONFIGURACOES_EMAIL_VISUALIZAR: "configuracoes.email.visualizar",
  CONFIGURACOES_EMAIL_EDITAR: "configuracoes.email.editar",
  CONFIGURACOES_EMAIL_MODELOS_VISUALIZAR: "configuracoes.email_modelos.visualizar",
  CONFIGURACOES_EMAIL_MODELOS_EDITAR: "configuracoes.email_modelos.editar",
  CONFIGURACOES_FERIADOS_VISUALIZAR: "configuracoes.feriados.visualizar",
  CONFIGURACOES_FERIADOS_ADICIONAR: "configuracoes.feriados.adicionar",
  CONFIGURACOES_FERIADOS_EDITAR: "configuracoes.feriados.editar",
  CONFIGURACOES_FERIADOS_EXCLUIR: "configuracoes.feriados.excluir",
  // Single record (the queue reminder's interval, see business settings),
  // so only visualizar/editar — same pattern as Identidade visual/E-mail.
  CONFIGURACOES_FILA_VISUALIZAR: "configuracoes.fila.visualizar",
  CONFIGURACOES_FILA_EDITAR: "configuracoes.fila.editar",
  AUDITORIA_ACESSAR: "auditoria.acessar",
  RESPOSTAS_RAPIDAS_GERENCIAR: "respostas_rapidas.gerenciar",
  // Each layered ON TOP of RESPOSTAS_RAPIDAS_GERENCIAR (need both) — see
  // that key's own doc comment. Respostas rápidas itself now also gets its
  // own granular set here (it used to rely on RESPOSTAS_RAPIDAS_GERENCIAR
  // alone for both the menu umbrella AND its own tab — those are now split
  // apart, same as every sibling tab below).
  RESPOSTAS_RAPIDAS_VISUALIZAR: "respostas_rapidas.visualizar",
  RESPOSTAS_RAPIDAS_ADICIONAR: "respostas_rapidas.adicionar",
  RESPOSTAS_RAPIDAS_EDITAR: "respostas_rapidas.editar",
  RESPOSTAS_RAPIDAS_EXCLUIR: "respostas_rapidas.excluir",
  RESPOSTAS_ENCERRAMENTO_VISUALIZAR: "respostas_encerramento.visualizar",
  RESPOSTAS_ENCERRAMENTO_ADICIONAR: "respostas_encerramento.adicionar",
  RESPOSTAS_ENCERRAMENTO_EDITAR: "respostas_encerramento.editar",
  RESPOSTAS_ENCERRAMENTO_EXCLUIR: "respostas_encerramento.excluir",
  RESPOSTAS_TRANSFERENCIA_VISUALIZAR: "respostas_transferencia.visualizar",
  RESPOSTAS_TRANSFERENCIA_ADICIONAR: "respostas_transferencia.adicionar",
  RESPOSTAS_TRANSFERENCIA_EDITAR: "respostas_transferencia.editar",
  RESPOSTAS_TRANSFERENCIA_EXCLUIR: "respostas_transferencia.excluir",
  RESPOSTAS_ACEITE_VISUALIZAR: "respostas_aceite.visualizar",
  RESPOSTAS_ACEITE_ADICIONAR: "respostas_aceite.adicionar",
  RESPOSTAS_ACEITE_EDITAR: "respostas_aceite.editar",
  RESPOSTAS_ACEITE_EXCLUIR: "respostas_aceite.excluir",
  // Motivo de Pausa — unlike the other Respostas tabs above (one combined
  // "gerenciar" permission each, before this round of granularization), this
  // one shipped with visualizar/adicionar/editar/excluir broken out from the
  // start (Etapa 5). See PROMPT: "nas permissões precisa estar discriminado
  // sobre poder editar, excluir, visualizar e adicionar". VISUALIZAR is this
  // tab's own umbrella (same role RESPOSTAS_RAPIDAS_GERENCIAR plays for the
  // whole menu) — still layered on top of RESPOSTAS_RAPIDAS_GERENCIAR.
  RESPOSTAS_MOTIVO_PAUSA_VISUALIZAR: "respostas_motivo_pausa.visualizar",
  RESPOSTAS_MOTIVO_PAUSA_ADICIONAR: "respostas_motivo_pausa.adicionar",
  RESPOSTAS_MOTIVO_PAUSA_EDITAR: "respostas_motivo_pausa.editar",
  RESPOSTAS_MOTIVO_PAUSA_EXCLUIR: "respostas_motivo_pausa.excluir",
  // Standalone top-level menu (not nested under CONFIGURACOES_GERENCIAR) —
  // see PROMPT: "planeje um novo menu chamado landing page". Single record
  // to edit (no list), so only visualizar/editar.
  LANDING_PAGE_VISUALIZAR: "landing_page.visualizar",
  LANDING_PAGE_EDITAR: "landing_page.editar",
  // Standalone top-level menu (not nested under CONFIGURACOES_GERENCIAR) —
  // one tab per channel. See PROMPT: "crie um novo menu chamado Conexões,
  // onde terá a aba WhatsApp, Instagram, Facebook e Site". WHATSAPP is a
  // real list (create/edit/delete connections), so it gets the full
  // granular set; INSTAGRAM/FACEBOOK/SITE gate tabs that only show a "not
  // connected yet" placeholder until those integrations exist, so they stay
  // a single permission each — nothing to cadastrar there yet.
  CONEXOES_GERENCIAR: "conexoes.gerenciar",
  CONEXOES_WHATSAPP_VISUALIZAR: "conexoes.whatsapp.visualizar",
  CONEXOES_WHATSAPP_ADICIONAR: "conexoes.whatsapp.adicionar",
  CONEXOES_WHATSAPP_EDITAR: "conexoes.whatsapp.editar",
  CONEXOES_WHATSAPP_EXCLUIR: "conexoes.whatsapp.excluir",
  CONEXOES_INSTAGRAM_GERENCIAR: "conexoes.instagram.gerenciar",
  CONEXOES_FACEBOOK_GERENCIAR: "conexoes.facebook.gerenciar",
  CONEXOES_SITE_GERENCIAR: "conexoes.site.gerenciar",
} as const;
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export interface PermissionDefinition {
  key: Permission;
  group: string;
  label: string;
  description: string;
  editableRoles: Role[];
  defaultAllowed: Partial<Record<Role, boolean>>;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: PERMISSION.ATENDIMENTO_ACESSAR,
    group: "Atendimento",
    label: "Acessar Atendimento",
    description: "Ver a fila, aceitar conversas e enviar mensagens, arquivos e localização.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.ATENDIMENTO_TRANSFERIR,
    group: "Atendimento",
    label: "Transferir conversas",
    description: "Transferir uma conversa em atendimento para outro atendente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.ATENDIMENTO_ENCERRAR,
    group: "Atendimento",
    label: "Encerrar conversas",
    description: "Encerrar uma conversa em atendimento.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.GESTAO_ACESSAR,
    group: "Gestão",
    label: "Acessar Gestão",
    description: "Visualizar, em modo leitura, as conversas de todos os atendentes. Necessária para qualquer outra permissão de Gestão.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.GESTAO_GERENCIAR,
    group: "Gestão",
    label: "Transferir e enviar para a fila pela Gestão",
    description: "Além de visualizar, poder transferir uma conversa para outro atendente ou devolvê-la para a fila diretamente pela Gestão.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.DASHBOARD_ACESSAR,
    group: "Dashboard",
    label: "Acessar Dashboard",
    description: "Visualizar indicadores e gráficos de desempenho.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RELATORIOS_ACESSAR,
    group: "Relatórios",
    label: "Acessar Relatórios",
    description: "Visualizar e exportar relatórios (CSV, PDF, Excel).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.USUARIOS_VISUALIZAR,
    group: "Usuários",
    label: "Usuários — visualizar",
    description: "Ver a lista de usuários cadastrados.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.USUARIOS_ADICIONAR,
    group: "Usuários",
    label: "Usuários — adicionar",
    description: "Cadastrar novos usuários.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.USUARIOS_EDITAR,
    group: "Usuários",
    label: "Usuários — editar",
    description: "Editar dados de um usuário existente, redefinir senha e desconectar sessão ativa.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.USUARIOS_INATIVAR,
    group: "Usuários",
    label: "Usuários — inativar",
    description: "Ativar ou inativar um usuário. Excluir de forma definitiva continua restrito ao Administrador.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_GERENCIAR,
    group: "Configurações",
    label: "Acessar Configurações",
    description:
      "Acesso geral à tela de Configurações. Necessária para qualquer uma das áreas abaixo — por padrão libera todas; restrinja áreas específicas desmarcando-as individualmente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: false },
  },
  {
    key: PERMISSION.CONFIGURACOES_IDENTIDADE_VISUALIZAR,
    group: "Configurações",
    label: "Configurações — Identidade visual (visualizar)",
    description: "Ver nome da empresa, cores, logo, ícone do app e favicon configurados.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_IDENTIDADE_EDITAR,
    group: "Configurações",
    label: "Configurações — Identidade visual (editar)",
    description: "Alterar nome da empresa, cores, logo, ícone do app e favicon.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_EMAIL_VISUALIZAR,
    group: "Configurações",
    label: "Configurações — E-mail, SMTP (visualizar)",
    description: "Ver as credenciais de SMTP configuradas (sem a senha).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_EMAIL_EDITAR,
    group: "Configurações",
    label: "Configurações — E-mail, SMTP (editar)",
    description: "Alterar as credenciais de SMTP e enviar e-mail de teste.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_EMAIL_MODELOS_VISUALIZAR,
    group: "Configurações",
    label: "Configurações — Modelos de e-mail (visualizar)",
    description: "Ver os modelos dos e-mails automáticos do sistema.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_EMAIL_MODELOS_EDITAR,
    group: "Configurações",
    label: "Configurações — Modelos de e-mail (editar)",
    description: "Editar os modelos dos e-mails automáticos do sistema (redefinição de senha, boas-vindas, etc).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FERIADOS_VISUALIZAR,
    group: "Configurações",
    label: "Configurações — Feriados (visualizar)",
    description: "Ver a lista de feriados cadastrados.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FERIADOS_ADICIONAR,
    group: "Configurações",
    label: "Configurações — Feriados (adicionar)",
    description: "Cadastrar feriados manualmente ou sincronizar os feriados nacionais do ano.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FERIADOS_EDITAR,
    group: "Configurações",
    label: "Configurações — Feriados (editar)",
    description: "Editar um feriado cadastrado manualmente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FERIADOS_EXCLUIR,
    group: "Configurações",
    label: "Configurações — Feriados (excluir)",
    description: "Excluir um feriado cadastrado.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FILA_VISUALIZAR,
    group: "Configurações",
    label: "Configurações — Fila (visualizar)",
    description: "Ver o intervalo configurado do lembrete de conversas aguardando na fila.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONFIGURACOES_FILA_EDITAR,
    group: "Configurações",
    label: "Configurações — Fila (editar)",
    description: "Alterar o intervalo do lembrete de conversas aguardando na fila.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.AUDITORIA_ACESSAR,
    group: "Auditoria",
    label: "Acessar log de auditoria",
    description: "Visualizar o histórico de ações realizadas no sistema.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: false },
  },
  {
    // Key left unchanged (still "respostas_rapidas.gerenciar") even though
    // it now also gates Encerramento — renaming it would orphan any
    // per-manager override already stored under the old string. See
    // PROMPT: "O menu de Respostas, deverá estar habilitado nas
    // permissões para o administrador e gestor."
    key: PERMISSION.RESPOSTAS_RAPIDAS_GERENCIAR,
    group: "Respostas",
    label: "Acessar Respostas",
    description:
      "Acesso geral ao menu Respostas. Necessária para qualquer uma das abas abaixo — por padrão libera todas; restrinja abas específicas desmarcando-as individualmente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_RAPIDAS_VISUALIZAR,
    group: "Respostas",
    label: "Respostas — Respostas rápidas (visualizar)",
    description: "Ver a lista de respostas rápidas acionadas no atendimento digitando \"/\".",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_RAPIDAS_ADICIONAR,
    group: "Respostas",
    label: "Respostas — Respostas rápidas (adicionar)",
    description: "Cadastrar novas respostas rápidas.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_RAPIDAS_EDITAR,
    group: "Respostas",
    label: "Respostas — Respostas rápidas (editar)",
    description: "Editar uma resposta rápida existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_RAPIDAS_EXCLUIR,
    group: "Respostas",
    label: "Respostas — Respostas rápidas (excluir)",
    description: "Excluir uma resposta rápida.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ENCERRAMENTO_VISUALIZAR,
    group: "Respostas",
    label: "Respostas — Encerramento (visualizar)",
    description: "Ver as mensagens de encerramento automático cadastradas (aba Encerramento).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ENCERRAMENTO_ADICIONAR,
    group: "Respostas",
    label: "Respostas — Encerramento (adicionar)",
    description: "Cadastrar novas mensagens de encerramento automático.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ENCERRAMENTO_EDITAR,
    group: "Respostas",
    label: "Respostas — Encerramento (editar)",
    description: "Editar uma mensagem de encerramento automático existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ENCERRAMENTO_EXCLUIR,
    group: "Respostas",
    label: "Respostas — Encerramento (excluir)",
    description: "Excluir uma mensagem de encerramento automático.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_TRANSFERENCIA_VISUALIZAR,
    group: "Respostas",
    label: "Respostas — Transferência (visualizar)",
    description: "Ver a mensagem automática enviada ao cliente quando a conversa é transferida (aba Transferência).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_TRANSFERENCIA_ADICIONAR,
    group: "Respostas",
    label: "Respostas — Transferência (adicionar)",
    description: "Cadastrar novas mensagens automáticas de transferência.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_TRANSFERENCIA_EDITAR,
    group: "Respostas",
    label: "Respostas — Transferência (editar)",
    description: "Editar uma mensagem automática de transferência existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_TRANSFERENCIA_EXCLUIR,
    group: "Respostas",
    label: "Respostas — Transferência (excluir)",
    description: "Excluir uma mensagem automática de transferência.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ACEITE_VISUALIZAR,
    group: "Respostas",
    label: "Respostas — Aceite (visualizar)",
    description: "Ver a mensagem automática enviada ao cliente quando o atendente aceita a conversa (aba Aceite).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ACEITE_ADICIONAR,
    group: "Respostas",
    label: "Respostas — Aceite (adicionar)",
    description: "Cadastrar novas mensagens automáticas de aceite.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ACEITE_EDITAR,
    group: "Respostas",
    label: "Respostas — Aceite (editar)",
    description: "Editar uma mensagem automática de aceite existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_ACEITE_EXCLUIR,
    group: "Respostas",
    label: "Respostas — Aceite (excluir)",
    description: "Excluir uma mensagem automática de aceite.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  // Motivo de Pausa — granular from the start (not a single "gerenciar"),
  // and restricted to ADMIN+MANAGER by default, unlike its Respostas
  // siblings above which default-allow AGENT too. See PROMPT: "as
  // permissões novas, devem estar habilitadas apenas para o administrador
  // e gestor".
  {
    key: PERMISSION.RESPOSTAS_MOTIVO_PAUSA_VISUALIZAR,
    group: "Respostas",
    label: "Respostas — Motivo de Pausa (visualizar)",
    description: "Ver a lista de motivos de pausa cadastrados (aba Motivo de Pausa).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_MOTIVO_PAUSA_ADICIONAR,
    group: "Respostas",
    label: "Respostas — Motivo de Pausa (adicionar)",
    description: "Cadastrar novos motivos de pausa.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_MOTIVO_PAUSA_EDITAR,
    group: "Respostas",
    label: "Respostas — Motivo de Pausa (editar)",
    description: "Editar o nome de um motivo de pausa existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.RESPOSTAS_MOTIVO_PAUSA_EXCLUIR,
    group: "Respostas",
    label: "Respostas — Motivo de Pausa (excluir)",
    description: "Excluir (desativar) um motivo de pausa.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.LANDING_PAGE_VISUALIZAR,
    group: "Landing Page",
    label: "Landing Page — visualizar",
    description: "Acessar a tela de Landing Page e ver as configurações atuais.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.LANDING_PAGE_EDITAR,
    group: "Landing Page",
    label: "Landing Page — editar",
    description: "Editar a tela de login (logo, alinhamento, subtítulo), reordenar/renomear os itens do menu principal e os títulos das páginas.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_GERENCIAR,
    group: "Conexões",
    label: "Acessar Conexões",
    description:
      "Acesso geral à tela de Conexões. Necessária para qualquer um dos canais abaixo — por padrão libera todos; restrinja canais específicos desmarcando-os individualmente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: false },
  },
  {
    key: PERMISSION.CONEXOES_WHATSAPP_VISUALIZAR,
    group: "Conexões",
    label: "Conexões — WhatsApp (visualizar)",
    description: "Ver a lista de conexões de WhatsApp cadastradas.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_WHATSAPP_ADICIONAR,
    group: "Conexões",
    label: "Conexões — WhatsApp (adicionar)",
    description: "Criar novas conexões de WhatsApp.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_WHATSAPP_EDITAR,
    group: "Conexões",
    label: "Conexões — WhatsApp (editar)",
    description: "Editar, conectar e desconectar uma conexão de WhatsApp existente.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_WHATSAPP_EXCLUIR,
    group: "Conexões",
    label: "Conexões — WhatsApp (excluir)",
    description: "Excluir uma conexão de WhatsApp.",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: false, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_INSTAGRAM_GERENCIAR,
    group: "Conexões",
    label: "Conexões — Instagram",
    description: "Gerenciar a conexão de Instagram (integração ainda não disponível).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_FACEBOOK_GERENCIAR,
    group: "Conexões",
    label: "Conexões — Facebook",
    description: "Gerenciar a conexão de Facebook Messenger (integração ainda não disponível).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
  {
    key: PERMISSION.CONEXOES_SITE_GERENCIAR,
    group: "Conexões",
    label: "Conexões — Site",
    description: "Gerenciar o widget de chat do site (integração ainda não disponível).",
    editableRoles: ["AGENT", "MANAGER"],
    defaultAllowed: { AGENT: true, MANAGER: true },
  },
];

export type PermissionMap = Record<Permission, boolean>;
