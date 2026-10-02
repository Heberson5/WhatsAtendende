import { Router } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { toFlowDetailDTO, toFlowListItemDTO } from "./flows.mapper";
import * as service from "./flows.service";

export const flowsRouter = Router();
flowsRouter.use(requireAuth);

const metaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  connectionIds: z.array(z.string().uuid()).optional(),
});
const patchSchema = metaSchema.partial().extend({ active: z.boolean().optional() });

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["START", "TEXT_MESSAGE", "MENU", "TRANSFER_TO_AGENT", "END"]),
  positionX: z.number(),
  positionY: z.number(),
  data: z.record(z.unknown()).optional(),
});
const edgeSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
});
const graphSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema) });

flowsRouter.get(
  "/",
  requirePermission(PERMISSION.FLUXO_VISUALIZAR),
  asyncHandler(async (_req, res) => {
    const rows = await service.listFlows();
    res.json(rows.map(toFlowListItemDTO));
  })
);

flowsRouter.get(
  "/:id",
  requirePermission(PERMISSION.FLUXO_VISUALIZAR),
  asyncHandler(async (req, res) => {
    const row = await service.getFlowDetail(req.params.id);
    res.json(toFlowDetailDTO(row));
  })
);

flowsRouter.post(
  "/",
  requirePermission(PERMISSION.FLUXO_ADICIONAR),
  asyncHandler(async (req, res) => {
    const input = metaSchema.parse(req.body);
    const row = await service.createFlow(input, req.auth!.userId);
    await writeAudit({ userId: req.auth!.userId, action: "FLOW_CREATED", entity: "Flow", entityId: row.id, ipAddress: req.ip ?? null, metadata: { name: input.name } });
    res.status(201).json(toFlowListItemDTO(row));
  })
);

flowsRouter.patch(
  "/:id",
  requirePermission(PERMISSION.FLUXO_EDITAR),
  asyncHandler(async (req, res) => {
    const input = patchSchema.parse(req.body);
    const row = await service.updateFlowMeta(req.params.id, input);
    await writeAudit({
      userId: req.auth!.userId,
      action: "FLOW_UPDATED",
      entity: "Flow",
      entityId: req.params.id,
      ipAddress: req.ip ?? null,
      metadata: { active: input.active },
    });
    res.json(toFlowListItemDTO(row));
  })
);

flowsRouter.put(
  "/:id/graph",
  requirePermission(PERMISSION.FLUXO_EDITAR),
  asyncHandler(async (req, res) => {
    const input = graphSchema.parse(req.body);
    const row = await service.saveFlowGraph(req.params.id, input.nodes, input.edges);
    await writeAudit({ userId: req.auth!.userId, action: "FLOW_GRAPH_SAVED", entity: "Flow", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.json(toFlowDetailDTO(row));
  })
);

flowsRouter.delete(
  "/:id",
  requirePermission(PERMISSION.FLUXO_EXCLUIR),
  asyncHandler(async (req, res) => {
    await service.deleteFlow(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "FLOW_DELETED", entity: "Flow", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(204).end();
  })
);
