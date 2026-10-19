import type { ContactPanelDTO, ConversationNoteDTO, PreviousConversationDetailDTO, TagDTO } from "@whatsatendende/types";
import { toMessageDTO } from "../messages/messages.mapper";
import { messageInclude } from "../messages/messages.service";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";

const PREVIOUS_CONVERSATIONS_LIMIT = 10;
// Palette new tags cycle through, so two consecutive tags never share a color.
const TAG_COLORS = ["#0097B4", "#7C3AED", "#DB2777", "#059669", "#EA580C", "#2563EB", "#CA8A04", "#64748B"];

export function toTagDTO(tag: { id: string; name: string; color: string }): TagDTO {
  return { id: tag.id, name: tag.name, color: tag.color };
}

// A note with no author was written by the system (e.g. why a conversation came from Abandonados).
export const SYSTEM_NOTE_AUTHOR = "Sistema";

export function toNoteDTO(note: { id: string; conversationId: string; authorId: string | null; body: string; createdAt: Date; author: { displayName: string } | null }): ConversationNoteDTO {
  return {
    id: note.id,
    conversationId: note.conversationId,
    authorId: note.authorId,
    authorName: note.author?.displayName ?? SYSTEM_NOTE_AUTHOR,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };
}

export async function listTags(): Promise<TagDTO[]> {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
  return tags.map(toTagDTO);
}

/** Case-insensitive find-or-create, so "vip" and "VIP" stay one tag. */
export async function findOrCreateTag(name: string): Promise<TagDTO> {
  const existing = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return toTagDTO(existing);
  const count = await prisma.tag.count();
  return toTagDTO(await prisma.tag.create({ data: { name, color: TAG_COLORS[count % TAG_COLORS.length] } }));
}

export async function getContactPanel(conversationId: string, contactId: string, firstConversationAt: Date): Promise<ContactPanelDTO> {
  const [contact, tags, previous, previousCount] = await Promise.all([
    prisma.contact.findUniqueOrThrow({ where: { id: contactId }, select: { pinnedNote: true, pinnedNoteUpdatedAt: true, pinnedNoteUpdatedBy: true } }),
    prisma.contactTag.findMany({ where: { contactId }, include: { tag: true }, orderBy: { createdAt: "asc" } }),
    prisma.conversation.findMany({
      where: { contactId, id: { not: conversationId } },
      orderBy: { enteredQueueAt: "desc" },
      take: PREVIOUS_CONVERSATIONS_LIMIT,
      include: {
        assignedAgent: { select: { displayName: true } },
        whatsappConnection: { select: { name: true } },
        metaConnection: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.conversation.count({ where: { contactId, id: { not: conversationId } } }),
  ]);
  return {
    contactId,
    firstConversationAt: firstConversationAt.toISOString(),
    tags: tags.map((t) => toTagDTO(t.tag)),
    previousConversations: previous.map((c) => ({
      id: c.id,
      status: c.status,
      agentName: c.assignedAgent?.displayName ?? null,
      connectionName: c.whatsappConnection?.name ?? c.metaConnection?.name ?? "",
      startedAt: c.enteredQueueAt.toISOString(),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      messageCount: c._count.messages,
    })),
    previousConversationCount: previousCount,
    pinnedNote: contact.pinnedNote
      ? { text: contact.pinnedNote, updatedAt: contact.pinnedNoteUpdatedAt!.toISOString(), updatedByName: contact.pinnedNoteUpdatedBy }
      : null,
  };
}

export async function setPinnedNote(contactId: string, text: string | null, userName: string) {
  await prisma.contact.update({
    where: { id: contactId },
    data: text ? { pinnedNote: text, pinnedNoteUpdatedAt: new Date(), pinnedNoteUpdatedBy: userName } : { pinnedNote: null, pinnedNoteUpdatedAt: null, pinnedNoteUpdatedBy: null },
  });
}

/** One earlier conversation of the same contact, read-only: its messages, notes and survey score. */
export async function getPreviousConversation(contactId: string, previousId: string): Promise<PreviousConversationDetailDTO> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: previousId, contactId },
    include: { assignedAgent: { select: { displayName: true } }, satisfactionSurvey: { select: { score: true, answerText: true } } },
  });
  if (!conversation) throw Errors.notFound("Conversa nao encontrada");
  const [messages, notes] = await Promise.all([
    prisma.message.findMany({ where: { conversationId: previousId, deletedAt: null }, orderBy: { createdAt: "asc" }, include: messageInclude }),
    listNotes(previousId),
  ]);
  return {
    id: conversation.id,
    status: conversation.status,
    agentName: conversation.assignedAgent?.displayName ?? null,
    startedAt: conversation.enteredQueueAt.toISOString(),
    closedAt: conversation.closedAt ? conversation.closedAt.toISOString() : null,
    messages: messages.map(toMessageDTO),
    notes,
    survey: conversation.satisfactionSurvey ? { score: conversation.satisfactionSurvey.score, answerText: conversation.satisfactionSurvey.answerText } : null,
  };
}

export async function addContactTag(contactId: string, tagId: string, userId: string) {
  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) throw Errors.notFound("Etiqueta nao encontrada");
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId } },
    create: { contactId, tagId, addedById: userId },
    update: {},
  });
}

export async function removeContactTag(contactId: string, tagId: string) {
  await prisma.contactTag.deleteMany({ where: { contactId, tagId } });
}

export async function listNotes(conversationId: string): Promise<ConversationNoteDTO[]> {
  const notes = await prisma.conversationNote.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { displayName: true } } },
  });
  return notes.map(toNoteDTO);
}

export async function createNote(conversationId: string, authorId: string, body: string): Promise<ConversationNoteDTO> {
  const note = await prisma.conversationNote.create({
    data: { conversationId, authorId, body },
    include: { author: { select: { displayName: true } } },
  });
  return toNoteDTO(note);
}
