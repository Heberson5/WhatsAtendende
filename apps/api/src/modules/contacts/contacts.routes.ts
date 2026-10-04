import { Router, type Request } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { parseListParam } from "../../lib/parse-list-param";
import { resolveAllowedConnectionIds } from "../../lib/connection-access";
import * as service from "./contacts.service";

export const contactsRouter = Router();
contactsRouter.use(requireAuth, requirePermission(PERMISSION.CONTATOS_ACESSAR));

const IMPORT_MAX_CSV_CHARS = 1_500_000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** An AGENT (if ever granted Contatos) sees only their own connection; a MANAGER the ones they manage; an ADMIN everything. */
async function visibleConnectionIds(req: Request, requested?: string[]): Promise<string[] | undefined> {
  if (req.auth!.role === "AGENT") {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { whatsappConnectionId: true } });
    return user?.whatsappConnectionId ? [user.whatsappConnectionId] : [];
  }
  return resolveAllowedConnectionIds(req.auth!, requested);
}

const filtersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  tagId: z.string().uuid().optional(),
  connectionId: z.union([z.string(), z.array(z.string())]).optional(),
});

async function parseFilters(req: Request): Promise<service.ContactFilters> {
  const query = filtersSchema.parse(req.query);
  return { search: query.search, tagId: query.tagId, connectionIds: await visibleConnectionIds(req, parseListParam(query.connectionId)) };
}

const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });

contactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = pageSchema.parse(req.query);
    res.json(await service.listContacts(await parseFilters(req), page, pageSize));
  })
);

contactsRouter.get(
  "/export",
  requirePermission(PERMISSION.CONTATOS_IMPORTAR_EXPORTAR),
  asyncHandler(async (req, res) => {
    const csv = await service.exportContactsCsv(await parseFilters(req));
    await writeAudit({ userId: req.auth!.userId, action: "CONTACTS_EXPORTED", entity: "Contact", entityId: null, ipAddress: req.ip ?? null });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contatos.csv"');
    res.send(csv);
  })
);

const importSchema = z.object({ whatsappConnectionId: z.string().uuid(), csv: z.string().min(1).max(IMPORT_MAX_CSV_CHARS) });

contactsRouter.post(
  "/import",
  requirePermission(PERMISSION.CONTATOS_IMPORTAR_EXPORTAR),
  asyncHandler(async (req, res) => {
    const input = importSchema.parse(req.body);
    const allowed = await visibleConnectionIds(req, [input.whatsappConnectionId]);
    if (allowed && !allowed.includes(input.whatsappConnectionId)) throw Errors.forbidden();
    const connection = await prisma.whatsAppConnection.findUnique({ where: { id: input.whatsappConnectionId } });
    if (!connection) throw Errors.badRequest("Conexão inválida");
    const result = await service.importContactsCsv(input.csv, input.whatsappConnectionId, req.auth!.userId);
    await writeAudit({
      userId: req.auth!.userId,
      action: "CONTACTS_IMPORTED",
      entity: "Contact",
      entityId: null,
      ipAddress: req.ip ?? null,
      metadata: { whatsappConnectionId: input.whatsappConnectionId, created: result.created, updated: result.updated, errors: result.errors.length },
    });
    res.json(result);
  })
);

// --- Etiquetas (declared before /:id so "tags" is never read as a contact id) ---

contactsRouter.get(
  "/tags",
  requirePermission(PERMISSION.CONTATOS_ETIQUETAS_GERENCIAR),
  asyncHandler(async (_req, res) => {
    res.json(await service.listManagedTags());
  })
);

const tagSchema = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(HEX_COLOR) });

contactsRouter.post(
  "/tags",
  requirePermission(PERMISSION.CONTATOS_ETIQUETAS_GERENCIAR),
  asyncHandler(async (req, res) => {
    const input = tagSchema.parse(req.body);
    const tag = await service.createTag(input);
    await writeAudit({ userId: req.auth!.userId, action: "TAG_CREATED", entity: "Tag", entityId: tag.id, ipAddress: req.ip ?? null, metadata: input });
    res.status(201).json(tag);
  })
);

contactsRouter.patch(
  "/tags/:tagId",
  requirePermission(PERMISSION.CONTATOS_ETIQUETAS_GERENCIAR),
  asyncHandler(async (req, res) => {
    const input = tagSchema.partial().parse(req.body);
    const tag = await service.updateTag(req.params.tagId, input);
    await writeAudit({ userId: req.auth!.userId, action: "TAG_UPDATED", entity: "Tag", entityId: tag.id, ipAddress: req.ip ?? null, metadata: input });
    res.json(tag);
  })
);

contactsRouter.delete(
  "/tags/:tagId",
  requirePermission(PERMISSION.CONTATOS_ETIQUETAS_GERENCIAR),
  asyncHandler(async (req, res) => {
    await service.deleteTag(req.params.tagId);
    await writeAudit({ userId: req.auth!.userId, action: "TAG_DELETED", entity: "Tag", entityId: req.params.tagId, ipAddress: req.ip ?? null });
    res.status(204).end();
  })
);

// --- Um contato ---

contactsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await service.getContactDetail(req.params.id, await visibleConnectionIds(req)));
  })
);

const updateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

contactsRouter.patch(
  "/:id",
  requirePermission(PERMISSION.CONTATOS_EDITAR),
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const connectionIds = await visibleConnectionIds(req);
    await service.getContactOrThrow(req.params.id, connectionIds);
    await service.updateContact(req.params.id, input, req.auth!.userId);
    await writeAudit({ userId: req.auth!.userId, action: "CONTACT_UPDATED", entity: "Contact", entityId: req.params.id, ipAddress: req.ip ?? null, metadata: input });
    res.json(await service.getContactDetail(req.params.id, connectionIds));
  })
);
