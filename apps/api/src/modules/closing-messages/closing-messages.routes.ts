import { Router } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { toClosingMessageDTO } from "./closing-messages.mapper";
import * as service from "./closing-messages.service";

export const closingMessagesRouter = Router();

closingMessagesRouter.use(requireAuth);
// Same audience as respostas rápidas — see PROMPT: "O menu de Respostas,
// deverá estar habilitado nas permissões para o administrador e gestor."
closingMessagesRouter.use(requirePermission(PERMISSION.RESPOSTAS_RAPIDAS_GERENCIAR));

closingMessagesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await service.listClosingMessages();
    res.json(rows.map(toClosingMessageDTO));
  })
);

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  text: z.string().min(1).max(4096),
  active: z.boolean(),
  userIds: z.array(z.string().uuid()),
});

closingMessagesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = bodySchema.parse(req.body);
    const row = await service.createClosingMessage(input);
    await writeAudit({
      userId: req.auth!.userId,
      action: "CLOSING_MESSAGE_CREATED",
      entity: "ClosingMessage",
      entityId: row.id,
      ipAddress: req.ip ?? null,
      metadata: { name: input.name, active: input.active, userIds: input.userIds },
    });
    res.status(201).json(toClosingMessageDTO(row));
  })
);

const updateSchema = bodySchema.partial();

closingMessagesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const row = await service.updateClosingMessage(req.params.id, input);
    await writeAudit({
      userId: req.auth!.userId,
      action: "CLOSING_MESSAGE_UPDATED",
      entity: "ClosingMessage",
      entityId: row.id,
      ipAddress: req.ip ?? null,
      metadata: input,
    });
    res.json(toClosingMessageDTO(row));
  })
);

closingMessagesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await service.deleteClosingMessage(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "CLOSING_MESSAGE_DELETED", entity: "ClosingMessage", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(204).end();
  })
);
