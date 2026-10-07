import type { Prisma } from "@prisma/client";
import type { ContactDetailDTO, ContactImportResultDTO, ContactListItemDTO, ManagedTagDTO, TagDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { findOrCreateTag, toTagDTO } from "../client-panel/client-panel.service";

/**
 * Tela de Contatos: search, tags, history, CSV import/export — plus the
 * tag management (rename, color, delete) shared with the client panel.
 * `connectionIds` follows resolveAllowedConnectionIds: undefined = every
 * contact (ADMIN), an array = only contacts of those WhatsApp connections.
 */

export interface ContactFilters {
  search?: string;
  tagId?: string;
  connectionIds?: string[];
}

const IMPORT_MAX_ROWS = 5000;
// Brazilian numbers typed without the country code (DDD + number).
const BR_LOCAL_LENGTHS = [10, 11];
const BR_COUNTRY_CODE = "55";

const listInclude = {
  whatsappConnection: { select: { name: true } },
  metaConnection: { select: { name: true } },
  tags: { include: { tag: true }, orderBy: { createdAt: "asc" as const } },
  _count: { select: { conversations: true } },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof listInclude }>;

function toListItem(row: ContactRow): ContactListItemDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    channel: row.channel,
    connectionName: row.whatsappConnection?.name ?? row.metaConnection?.name ?? null,
    tags: row.tags.map((t) => toTagDTO(t.tag)),
    conversationCount: row._count.conversations,
    firstConversationAt: row.firstConversationAt.toISOString(),
    lastInteractionAt: row.lastInteractionAt.toISOString(),
  };
}

function buildWhere(filters: ContactFilters): Prisma.ContactWhereInput {
  const search = filters.search?.trim();
  const digits = search?.replace(/\D/g, "");
  return {
    ...(filters.connectionIds && { whatsappConnectionId: { in: filters.connectionIds } }),
    ...(filters.tagId && { tags: { some: { tagId: filters.tagId } } }),
    ...(search && {
      OR: [{ name: { contains: search, mode: "insensitive" as const } }, ...(digits ? [{ phone: { contains: digits } }] : [])],
    }),
  };
}

export async function listContacts(filters: ContactFilters, page: number, pageSize: number) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({ where, include: listInclude, orderBy: { lastInteractionAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contact.count({ where }),
  ]);
  return { items: rows.map(toListItem), total };
}

/** Throws 404 when the contact doesn't exist or sits on a connection this user can't see. */
export async function getContactOrThrow(id: string, connectionIds: string[] | undefined) {
  const row = await prisma.contact.findFirst({ where: { id, ...(connectionIds && { whatsappConnectionId: { in: connectionIds } }) }, include: listInclude });
  if (!row) throw Errors.notFound("Contato não encontrado");
  return row;
}

export async function getContactDetail(id: string, connectionIds: string[] | undefined): Promise<ContactDetailDTO> {
  const row = await getContactOrThrow(id, connectionIds);
  const conversations = await prisma.conversation.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      closedAt: true,
      assignedAgent: { select: { displayName: true } },
      satisfactionSurvey: { select: { score: true, questionId: true } },
      _count: { select: { messages: true } },
    },
  });
  return {
    ...toListItem(row),
    conversations: conversations.map((c) => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      closedAt: c.closedAt?.toISOString() ?? null,
      agentName: c.assignedAgent?.displayName ?? null,
      messageCount: c._count.messages,
      satisfactionScore: c.satisfactionSurvey?.score ?? null,
      // Surveys without a question were answered on the old 1–5 scale.
      satisfactionScoreMax: c.satisfactionSurvey?.score == null ? null : c.satisfactionSurvey.questionId ? 10 : 5,
    })),
  };
}

export async function updateContact(id: string, input: { name?: string; tagIds?: string[] }, userId: string) {
  if (input.tagIds) {
    const count = await prisma.tag.count({ where: { id: { in: input.tagIds } } });
    if (count !== new Set(input.tagIds).size) throw Errors.badRequest("Uma ou mais etiquetas são inválidas");
  }
  await prisma.$transaction([
    ...(input.name !== undefined ? [prisma.contact.update({ where: { id }, data: { name: input.name } })] : []),
    ...(input.tagIds
      ? [
          prisma.contactTag.deleteMany({ where: { contactId: id, tagId: { notIn: input.tagIds } } }),
          prisma.contactTag.createMany({ data: input.tagIds.map((tagId) => ({ contactId: id, tagId, addedById: userId })), skipDuplicates: true }),
        ]
      : []),
  ]);
}

// --- CSV ---

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Semicolon-separated (opens straight in Excel pt-BR), with a BOM so accents survive. */
export async function exportContactsCsv(filters: ContactFilters): Promise<string> {
  const rows = await prisma.contact.findMany({ where: buildWhere(filters), include: listInclude, orderBy: { name: "asc" } });
  const header = ["Nome", "Telefone", "Conexão", "Etiquetas", "Conversas", "Primeiro contato", "Última interação"];
  const lines = rows.map((r) => {
    const item = toListItem(r);
    return [
      item.name,
      item.phone,
      item.connectionName,
      item.tags.map((t) => t.name).join(", "),
      item.conversationCount,
      r.firstConversationAt.toISOString().slice(0, 10),
      r.lastInteractionAt.toISOString().slice(0, 10),
    ]
      .map(csvEscape)
      .join(";");
  });
  return "\uFEFF" + [header.join(";"), ...lines].join("\r\n");
}

/** Splits one CSV line on `delimiter`, honoring "quoted, values" and "" escapes. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

export function normalizeImportPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (BR_LOCAL_LENGTHS.includes(digits.length)) return BR_COUNTRY_CODE + digits;
  return digits.length >= 12 && digits.length <= 15 ? digits : null;
}

const normalizeHeader = (h: string) => h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Columns (any order, header row required): Nome, Telefone, Etiquetas
 * (several separated by ","). An existing phone on the connection is
 * updated (name, added tags); a new one is created. Lines with problems
 * are skipped and reported back.
 */
export async function importContactsCsv(csv: string, whatsappConnectionId: string, userId: string): Promise<ContactImportResultDTO> {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw Errors.badRequest("A planilha precisa ter o cabeçalho e pelo menos um contato");
  if (lines.length - 1 > IMPORT_MAX_ROWS) throw Errors.badRequest(`Importe no máximo ${IMPORT_MAX_ROWS} contatos por vez`);

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  const col = { name: header.indexOf("nome"), phone: header.indexOf("telefone"), tags: header.indexOf("etiquetas") };
  if (col.phone === -1) throw Errors.badRequest('A planilha precisa de uma coluna "Telefone"');

  const result: ContactImportResultDTO = { created: 0, updated: 0, errors: [] };
  const tagCache = new Map<string, TagDTO>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const phone = normalizeImportPhone(cells[col.phone] ?? "");
    if (!phone) {
      result.errors.push({ line: i + 1, reason: `Telefone inválido: "${cells[col.phone] ?? ""}"` });
      continue;
    }
    const name = col.name === -1 ? "" : (cells[col.name] ?? "").slice(0, 120);
    const tagNames = col.tags === -1 ? [] : (cells[col.tags] ?? "").split(",").map((t) => t.trim().slice(0, 40)).filter(Boolean);

    const existing = await prisma.contact.findUnique({ where: { phone_whatsappConnectionId: { phone, whatsappConnectionId } } });
    const contact = existing
      ? await prisma.contact.update({ where: { id: existing.id }, data: name ? { name } : {} })
      : await prisma.contact.create({ data: { channel: "WHATSAPP", phone, whatsappConnectionId, name: name || null } });
    if (existing) result.updated++;
    else result.created++;

    for (const tagName of tagNames) {
      const key = tagName.toLowerCase();
      const tag = tagCache.get(key) ?? (await findOrCreateTag(tagName));
      tagCache.set(key, tag);
      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
        update: {},
        create: { contactId: contact.id, tagId: tag.id, addedById: userId },
      });
    }
  }
  return result;
}

// --- Etiquetas ---

export async function listManagedTags(): Promise<ManagedTagDTO[]> {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
  return tags.map((t) => ({ ...toTagDTO(t), contactCount: t._count.contacts }));
}

async function assertTagNameFree(name: string, excludeId?: string) {
  const clash = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(excludeId && { id: { not: excludeId } }) } });
  if (clash) throw Errors.conflict(`Já existe a etiqueta "${clash.name}"`);
}

export async function createTag(input: { name: string; color: string }): Promise<TagDTO> {
  await assertTagNameFree(input.name);
  return toTagDTO(await prisma.tag.create({ data: input }));
}

export async function updateTag(id: string, input: { name?: string; color?: string }): Promise<TagDTO> {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) throw Errors.notFound("Etiqueta não encontrada");
  if (input.name) await assertTagNameFree(input.name, id);
  return toTagDTO(await prisma.tag.update({ where: { id }, data: input }));
}

export async function deleteTag(id: string): Promise<void> {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) throw Errors.notFound("Etiqueta não encontrada");
  await prisma.tag.delete({ where: { id } });
}
