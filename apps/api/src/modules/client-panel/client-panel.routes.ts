import { Router, type Request } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import {
  assertAgentCanAccessConversation,
  assertAgentCanReadConversation,
  getConversationOrThrow,
} from "../conversations/conversations.service";
import * as service from "./client-panel.service";

// Mounted next to conversationsRouter (/api/conversations/:id/...): the
// client panel beside the chat (tags, earlier conversations) and internal notes.
export const clientPanelRouter = Router();
clientPanelRouter.use(requireAuth);
const requireAttendanceAccess = requirePermission(PERMISSION.ATENDIMENTO_ACESSAR);

/** Same rule as reading the messages: an AGENT only sees what's theirs (or what they transferred away). */
async function conversationForRead(req: Request) {
  const conversation = await getConversationOrThrow(req.params.id);
  if (req.auth!.role === "AGENT") await assertAgentCanReadConversation(conversation, req.auth!);
  return conversation;
}

/** Writing (tags, notes) needs the conversation to be the AGENT's own; MANAGER/ADMIN can annotate any. */
async function conversationForWrite(req: Request) {
  const conversation = await getConversationOrThrow(req.params.id);
  if (req.auth!.role === "AGENT") assertAgentCanAccessConversation(conversation, req.auth!);
  return conversation;
}

clientPanelRouter.get(
  "/:id/contact-panel",
  asyncHandler(async (req, res) => {
    const conversation = await conversationForRead(req);
    res.json(await service.getContactPanel(conversation.id, conversation.contactId, conversation.contact.firstConversationAt));
  })
);

const addTagSchema = z.union([z.object({ tagId: z.string().uuid() }), z.object({ name: z.string().trim().min(1).max(40) })]);
clientPanelRouter.post(
  "/:id/contact-tags",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const conversation = await conversationForWrite(req);
    const input = addTagSchema.parse(req.body);
    const tagId = "tagId" in input ? input.tagId : (await service.findOrCreateTag(input.name)).id;
    await service.addContactTag(conversation.contactId, tagId, req.auth!.userId);
    await writeAudit({ userId: req.auth!.userId, action: "CONTACT_TAG_ADDED", entity: "Contact", entityId: conversation.contactId, ipAddress: req.ip ?? null, metadata: { tagId } });
    res.status(201).json(await service.getContactPanel(conversation.id, conversation.contactId, conversation.contact.firstConversationAt));
  })
);

clientPanelRouter.delete(
  "/:id/contact-tags/:tagId",
  requireAttendanceAccess,
  asyncHandler(async (req, res) => {
    const conversation = await conversationForWrite(req);
    await service.removeContactTag(conversation.contactId, req.params.tagId);
    await writeAudit({ userId: req.auth!.userId, action: "CONTACT_TAG_REMOVED", entity: "Contact", entityId: conversation.contactId, ipAddress: req.ip ?? null, metadata: { tagId: req.params.tagId } });
    res.json(await service.getContactPanel(conversation.id, conversation.contactId, conversation.contact.firstConversationAt));
  })
);

clientPanelRouter.get(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const conversation = await conversationForRead(req);
    res.json(await service.listNotes(conversation.id));
  })
);

const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
clientPanelRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const conversation = await conversationForWrite(req);
    const { body } = noteSchema.parse(req.body);
    const note = await service.createNote(conversation.id, req.auth!.userId, body);
    await writeAudit({ userId: req.auth!.userId, action: "CONVERSATION_NOTE_CREATED", entity: "Conversation", entityId: conversation.id, ipAddress: req.ip ?? null });
    res.status(201).json(note);
  })
);

export const tagsRouter = Router();
tagsRouter.use(requireAuth);
tagsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await service.listTags());
  })
);
