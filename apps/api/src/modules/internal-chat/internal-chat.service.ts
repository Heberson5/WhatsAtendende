import type { ChatMember, ChatMessage, ChatRoom, Prisma } from "@prisma/client";
import type { ChatMemberDTO, ChatMessageDTO, ChatRoomDTO, ChatUserDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { realtimeEvents } from "../../realtime/realtime";

export const GENERAL_NAME = "#Geral";
const PAGE_SIZE = 50;

type RoomWithMembers = ChatRoom & { members: ChatMember[] };
type Users = Map<string, ChatUserDTO>;

async function usersById(ids: string[]): Promise<Users> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, displayName: true, photoUrl: true, presence: true } });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.displayName, photoUrl: u.photoUrl, presence: u.presence }]));
}

export async function listChatUsers(): Promise<ChatUserDTO[]> {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, displayName: true, photoUrl: true, presence: true }, orderBy: { displayName: "asc" } });
  return users.map((u) => ({ id: u.id, name: u.displayName, photoUrl: u.photoUrl, presence: u.presence }));
}

/** #Geral exists once and every active person is in it. */
async function ensureGeneral(userId: string) {
  const room = (await prisma.chatRoom.findFirst({ where: { kind: "GENERAL" } })) ?? (await prisma.chatRoom.create({ data: { kind: "GENERAL", name: GENERAL_NAME } }));
  await prisma.chatMember.upsert({ where: { roomId_userId: { roomId: room.id, userId } }, create: { roomId: room.id, userId }, update: {} });
  return room;
}

const activeMembers = (room: RoomWithMembers) => room.members.filter((m) => !m.leftAt);

/** What a member may see of the room: messages after they joined without history. */
function visibleWhere(member: ChatMember): Prisma.ChatMessageWhereInput {
  return { roomId: member.roomId, ...(member.historyFrom ? { createdAt: { gte: member.historyFrom } } : {}) };
}

export async function memberOrThrow(roomId: string, userId: string) {
  const member = await prisma.chatMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
  if (!member || member.leftAt) throw Errors.notFound("Conversa nao encontrada");
  const room = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } });
  return { member, room };
}

function toMemberDTO(member: ChatMember, room: ChatRoom, users: Users): ChatMemberDTO {
  const user = users.get(member.userId);
  return {
    userId: member.userId,
    name: user?.name ?? "Usuário removido",
    photoUrl: user?.photoUrl ?? null,
    presence: user?.presence ?? "OFFLINE",
    isOwner: room.ownerId === member.userId,
    isAdmin: member.isAdmin,
  };
}

function messagePreview(message: ChatMessage): string {
  return message.body ?? (message.attachmentName ? `📎 ${message.attachmentName}` : "");
}

async function toRoomDTO(room: RoomWithMembers, me: ChatMember, users: Users): Promise<ChatRoomDTO> {
  const members = activeMembers(room).map((m) => toMemberDTO(m, room, users));
  const [last, unreadCount] = await Promise.all([
    prisma.chatMessage.findFirst({ where: visibleWhere(me), orderBy: { createdAt: "desc" } }),
    prisma.chatMessage.count({
      where: {
        ...visibleWhere(me),
        ...(me.lastReadAt ? { createdAt: { gt: me.lastReadAt, ...(me.historyFrom ? { gte: me.historyFrom } : {}) } } : {}),
        OR: [{ authorId: null }, { authorId: { not: me.userId } }],
      },
    }),
  ]);
  const peer = room.kind === "DIRECT" ? (members.find((m) => m.userId !== me.userId) ?? null) : null;
  const isOwner = room.ownerId === me.userId;
  return {
    id: room.id,
    kind: room.kind,
    name: room.kind === "DIRECT" ? (peer?.name ?? "Conversa") : (room.name ?? GENERAL_NAME),
    peer,
    members,
    lastMessage: last ? { body: messagePreview(last), authorName: last.authorId ? (users.get(last.authorId)?.name ?? null) : null, createdAt: last.createdAt.toISOString() } : null,
    unreadCount,
    canManageMembers: room.kind === "GROUP" && (isOwner || me.isAdmin),
    canManageAdmins: room.kind === "GROUP" && isOwner,
    canLeave: room.kind === "GROUP",
  };
}

export async function listRooms(userId: string): Promise<ChatRoomDTO[]> {
  await ensureGeneral(userId);
  const memberships = await prisma.chatMember.findMany({ where: { userId, leftAt: null }, include: { room: { include: { members: true } } } });
  const users = await usersById(memberships.flatMap((m) => m.room.members.map((x) => x.userId)));
  const rooms = await Promise.all(memberships.map((m) => toRoomDTO(m.room, m, users)));
  return rooms.sort((a, b) => {
    if (a.kind === "GENERAL") return -1;
    if (b.kind === "GENERAL") return 1;
    return (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "");
  });
}

export async function getRoom(roomId: string, userId: string): Promise<ChatRoomDTO> {
  const { member, room } = await memberOrThrow(roomId, userId);
  return toRoomDTO(room, member, await usersById(room.members.map((m) => m.userId)));
}

function toMessageDTO(message: ChatMessage, users: Users, readers: ChatMember[], contacts: Map<string, string>): ChatMessageDTO {
  const others = readers.filter((r) => r.userId !== message.authorId && !r.leftAt);
  return {
    id: message.id,
    roomId: message.roomId,
    authorId: message.authorId,
    authorName: message.authorId ? (users.get(message.authorId)?.name ?? "Usuário removido") : null,
    body: message.body,
    attachment: message.attachmentKey
      ? { name: message.attachmentName!, mimeType: message.attachmentMimeType!, size: message.attachmentSize!, url: `/internal-chat/attachments/${message.id}` }
      : null,
    conversation: message.conversationId ? { id: message.conversationId, contactName: contacts.get(message.conversationId) ?? "Conversa" } : null,
    createdAt: message.createdAt.toISOString(),
    readByAll: others.length > 0 && others.every((r) => r.lastReadAt && r.lastReadAt >= message.createdAt),
  };
}

async function messagesPage(where: Prisma.ChatMessageWhereInput, room: RoomWithMembers, before?: string): Promise<ChatMessageDTO[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { ...where, ...(before ? { createdAt: { lt: new Date(before), ...((where.createdAt as object) ?? {}) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });
  const users = await usersById([...rows.flatMap((m) => (m.authorId ? [m.authorId] : [])), ...room.members.map((m) => m.userId)]);
  const conversationIds = rows.flatMap((m) => (m.conversationId ? [m.conversationId] : []));
  const conversations = conversationIds.length
    ? await prisma.conversation.findMany({ where: { id: { in: conversationIds } }, select: { id: true, contact: { select: { name: true, phone: true } } } })
    : [];
  const contacts = new Map(conversations.map((c) => [c.id, c.contact.name ?? c.contact.phone ?? "Cliente"]));
  return rows.reverse().map((m) => toMessageDTO(m, users, room.members, contacts));
}

export async function listMessages(roomId: string, userId: string, before?: string) {
  const { member, room } = await memberOrThrow(roomId, userId);
  return messagesPage(visibleWhere(member), room, before);
}

function notify(room: RoomWithMembers, event: string, payload: unknown, exceptUserId?: string) {
  realtimeEvents.internalChat(
    activeMembers(room)
      .map((m) => m.userId)
      .filter((id) => id !== exceptUserId),
    event,
    payload
  );
}

async function systemLine(room: RoomWithMembers, body: string) {
  await prisma.chatMessage.create({ data: { roomId: room.id, body } });
  notify(room, "internal-chat:message", { roomId: room.id });
}

export interface NewChatMessage {
  body?: string | null;
  conversationId?: string | null;
  attachment?: { key: string; name: string; mimeType: string; size: number };
}

export async function sendMessage(roomId: string, userId: string, input: NewChatMessage): Promise<ChatMessageDTO> {
  const { room } = await memberOrThrow(roomId, userId);
  if (!input.body?.trim() && !input.attachment && !input.conversationId) throw Errors.badRequest("Mensagem vazia");
  if (input.conversationId && !(await prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true } }))) {
    throw Errors.badRequest("Conversa do cliente nao encontrada");
  }
  const message = await prisma.chatMessage.create({
    data: {
      roomId,
      authorId: userId,
      body: input.body?.trim() || null,
      conversationId: input.conversationId ?? null,
      attachmentKey: input.attachment?.key,
      attachmentName: input.attachment?.name,
      attachmentMimeType: input.attachment?.mimeType,
      attachmentSize: input.attachment?.size,
    },
  });
  await prisma.chatMember.update({ where: { roomId_userId: { roomId, userId } }, data: { lastReadAt: message.createdAt } });
  const author = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  notify(room, "internal-chat:message", { roomId, authorName: author.displayName, preview: messagePreview(message), roomName: room.kind === "DIRECT" ? author.displayName : room.name }, userId);
  const [dto] = await messagesPage({ id: message.id }, room);
  return dto;
}

export async function markRead(roomId: string, userId: string) {
  const { room } = await memberOrThrow(roomId, userId);
  await prisma.chatMember.update({ where: { roomId_userId: { roomId, userId } }, data: { lastReadAt: new Date() } });
  notify(room, "internal-chat:read", { roomId, userId });
}

export async function typing(roomId: string, userId: string) {
  const { room } = await memberOrThrow(roomId, userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  notify(room, "internal-chat:typing", { roomId, userId, name: user.displayName }, userId);
}

export async function openDirect(userId: string, peerId: string): Promise<ChatRoomDTO> {
  if (userId === peerId) throw Errors.badRequest("Escolha outra pessoa");
  const peer = await prisma.user.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "ACTIVE") throw Errors.badRequest("Pessoa nao encontrada");
  const existing = await prisma.chatRoom.findFirst({
    where: { kind: "DIRECT", AND: [{ members: { some: { userId } } }, { members: { some: { userId: peerId } } }] },
  });
  const room = existing ?? (await prisma.chatRoom.create({ data: { kind: "DIRECT", members: { create: [{ userId }, { userId: peerId }] } } }));
  return getRoom(room.id, userId);
}

export async function createGroup(userId: string, name: string, memberIds: string[]): Promise<ChatRoomDTO> {
  const ids = [...new Set(memberIds.filter((id) => id !== userId))];
  const valid = await prisma.user.count({ where: { id: { in: ids }, status: "ACTIVE" } });
  if (valid !== ids.length) throw Errors.badRequest("Alguma pessoa escolhida nao existe ou esta inativa");
  const room = await prisma.chatRoom.create({
    data: { kind: "GROUP", name, ownerId: userId, members: { create: [{ userId }, ...ids.map((id) => ({ userId: id }))] } },
    include: { members: true },
  });
  const creator = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  await systemLine(room, `${creator.displayName} criou o grupo`);
  notify(room, "internal-chat:rooms", {});
  return getRoom(room.id, userId);
}

async function groupForManager(roomId: string, userId: string, ownerOnly: boolean) {
  const { member, room } = await memberOrThrow(roomId, userId);
  if (room.kind !== "GROUP") throw Errors.badRequest("So grupos tem membros e administradores");
  const isOwner = room.ownerId === userId;
  if (ownerOnly ? !isOwner : !isOwner && !member.isAdmin) {
    throw Errors.forbidden(ownerOnly ? "So quem criou o grupo escolhe os administradores" : "So o dono e os administradores do grupo adicionam pessoas");
  }
  return room;
}

export async function addMembers(roomId: string, userId: string, userIds: string[], canSeeHistory: boolean): Promise<ChatRoomDTO> {
  const room = await groupForManager(roomId, userId, false);
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, status: "ACTIVE" }, select: { id: true, displayName: true } });
  const now = new Date();
  const added: string[] = [];
  for (const user of users) {
    const current = room.members.find((m) => m.userId === user.id);
    if (current && !current.leftAt) continue;
    await prisma.chatMember.upsert({
      where: { roomId_userId: { roomId, userId: user.id } },
      create: { roomId, userId: user.id, historyFrom: canSeeHistory ? null : now },
      update: { leftAt: null, isAdmin: false, joinedAt: now, lastReadAt: null, historyFrom: canSeeHistory ? null : now },
    });
    added.push(user.displayName);
  }
  if (added.length) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    const fresh = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } });
    await systemLine(fresh, `${actor.displayName} adicionou ${added.join(", ")}`);
    notify(fresh, "internal-chat:rooms", {});
  }
  return getRoom(roomId, userId);
}

export async function setAdmin(roomId: string, userId: string, targetId: string, admin: boolean): Promise<ChatRoomDTO> {
  const room = await groupForManager(roomId, userId, true);
  const target = room.members.find((m) => m.userId === targetId && !m.leftAt);
  if (!target || targetId === room.ownerId) throw Errors.badRequest("Escolha um membro do grupo");
  await prisma.chatMember.update({ where: { id: target.id }, data: { isAdmin: admin } });
  notify(room, "internal-chat:rooms", {});
  return getRoom(roomId, userId);
}

/** Leaving makes the group disappear for that person; the owner's role passes to the oldest admin, else the oldest member. */
export async function leaveGroup(roomId: string, userId: string) {
  const { room } = await memberOrThrow(roomId, userId);
  if (room.kind !== "GROUP") throw Errors.badRequest("So e possivel sair de grupos");
  await prisma.chatMember.update({ where: { roomId_userId: { roomId, userId } }, data: { leftAt: new Date(), isAdmin: false } });
  if (room.ownerId === userId) {
    const remaining = activeMembers(room)
      .filter((m) => m.userId !== userId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
    const next = remaining.find((m) => m.isAdmin) ?? remaining[0] ?? null;
    await prisma.chatRoom.update({ where: { id: roomId }, data: { ownerId: next?.userId ?? null } });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  const fresh = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } });
  await systemLine(fresh, `${user.displayName} saiu do grupo`);
  notify(fresh, "internal-chat:rooms", {});
  realtimeEvents.internalChat([userId], "internal-chat:rooms", {});
}

/** Attachment of a message, for a member who can see it — or for oversight. */
export async function attachmentFor(messageId: string, userId: string, oversight: boolean) {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message?.attachmentKey) throw Errors.notFound("Arquivo nao encontrado");
  if (!oversight) {
    const { member } = await memberOrThrow(message.roomId, userId);
    if (member.historyFrom && message.createdAt < member.historyFrom) throw Errors.notFound("Arquivo nao encontrado");
  }
  return message;
}

// --- Gestão › Chat interno (no signal to who is talking) ---------------------

export async function oversightRooms() {
  const rooms = await prisma.chatRoom.findMany({ include: { members: true }, orderBy: { createdAt: "asc" } });
  const users = await usersById(rooms.flatMap((r) => r.members.map((m) => m.userId)));
  const result = [];
  for (const room of rooms) {
    const last = await prisma.chatMessage.findFirst({ where: { roomId: room.id }, orderBy: { createdAt: "desc" } });
    if (!last && room.kind !== "GENERAL") continue;
    const members = activeMembers(room).map((m) => toMemberDTO(m, room, users));
    result.push({
      id: room.id,
      kind: room.kind,
      name: room.kind === "DIRECT" ? members.map((m) => m.name).join(" ↔ ") : (room.name ?? GENERAL_NAME),
      members,
      lastMessageAt: last?.createdAt.toISOString() ?? null,
    });
  }
  return result.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
}

export async function oversightMessages(roomId: string, before?: string) {
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, include: { members: true } });
  if (!room) throw Errors.notFound("Conversa nao encontrada");
  return messagesPage({ roomId }, room, before);
}
