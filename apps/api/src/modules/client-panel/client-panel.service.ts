import type { ContactPanelDTO, ConversationNoteDTO, TagDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";

const PREVIOUS_CONVERSATIONS_LIMIT = 10;
// Palette new tags cycle through, so two consecutive tags never share a color.
const TAG_COLORS = ["#0097B4", "#7C3AED", "#DB2777", "#059669", "#EA580C", "#2563EB", "#CA8A04", "#64748B"];

export function toTagDTO(tag: { id: string; name: string; color: string }): TagDTO {
  return { id: tag.id, name: tag.name, color: tag.color };
}

export function toNoteDTO(note: { id: string; conversationId: string; authorId: string; body: string; createdAt: Date; author: { displayName: string } }): ConversationNoteDTO {
  return {
    id: note.id,
    conversationId: note.conversationId,
    authorId: note.authorId,
    authorName: note.author.displayName,
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
  const [tags, previous, previousCount] = await Promise.all([
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
