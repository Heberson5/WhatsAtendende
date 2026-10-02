import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { FLOW_DETAIL_INCLUDE, FLOW_LIST_INCLUDE } from "./flows.mapper";

export interface FlowMetaInput {
  name: string;
  description?: string | null;
  connectionIds?: string[];
}

async function assertOfficialConnections(connectionIds: string[]): Promise<void> {
  if (connectionIds.length === 0) return;
  const rows = await prisma.whatsAppConnection.findMany({
    where: { id: { in: connectionIds } },
    select: { id: true, connectionMode: true },
  });
  if (rows.length !== connectionIds.length) throw Errors.badRequest("Uma ou mais conexoes informadas nao existem");
  if (rows.some((r) => r.connectionMode !== "OFFICIAL_API")) {
    throw Errors.badRequest("Fluxos so podem ser vinculados a conexoes WhatsApp Oficial");
  }
}

export async function listFlows() {
  return prisma.flow.findMany({ include: FLOW_LIST_INCLUDE, orderBy: { createdAt: "desc" } });
}

export async function getFlowDetail(id: string) {
  const row = await prisma.flow.findUnique({ where: { id }, include: FLOW_DETAIL_INCLUDE });
  if (!row) throw Errors.notFound("Fluxo nao encontrado");
  return row;
}

/** A brand-new flow always starts with a single START node — the canvas's one fixed entry point, see FlowNodeType.START. */
export async function createFlow(input: FlowMetaInput, createdByUserId: string) {
  const connectionIds = input.connectionIds ?? [];
  await assertOfficialConnections(connectionIds);

  const flow = await prisma.flow.create({
    data: {
      name: input.name,
      description: input.description || null,
      createdByUserId,
      connections: { create: connectionIds.map((whatsappConnectionId) => ({ whatsappConnectionId })) },
      nodes: { create: [{ type: "START", positionX: 80, positionY: 160, data: {} }] },
    },
    include: FLOW_LIST_INCLUDE,
  });
  return flow;
}

export async function updateFlowMeta(id: string, input: Partial<FlowMetaInput> & { active?: boolean }) {
  const existing = await prisma.flow.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw Errors.notFound("Fluxo nao encontrado");

  if (input.connectionIds) await assertOfficialConnections(input.connectionIds);

  await prisma.$transaction(async (tx) => {
    await tx.flow.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description === undefined ? undefined : input.description || null,
        active: input.active,
      },
    });
    if (input.connectionIds) {
      await tx.flowConnection.deleteMany({ where: { flowId: id } });
      if (input.connectionIds.length > 0) {
        await tx.flowConnection.createMany({ data: input.connectionIds.map((whatsappConnectionId) => ({ flowId: id, whatsappConnectionId })) });
      }
    }
  });

  return prisma.flow.findUniqueOrThrow({ where: { id }, include: FLOW_LIST_INCLUDE });
}

export async function deleteFlow(id: string): Promise<void> {
  const existing = await prisma.flow.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw Errors.notFound("Fluxo nao encontrado");
  // FlowConnection/FlowNode/FlowEdge/FlowSession all cascade from Flow.
  await prisma.flow.delete({ where: { id } });
}

export interface FlowGraphNodeInput {
  id: string; // client-assigned — a real UUID for an existing node, any unique string for a new one
  type: "START" | "TEXT_MESSAGE" | "MENU" | "TRANSFER_TO_AGENT" | "END";
  positionX: number;
  positionY: number;
  data?: Record<string, unknown>;
}

export interface FlowGraphEdgeInput {
  sourceNodeId: string; // one of the client ids above
  targetNodeId: string;
  sourceHandle?: string | null;
}

/**
 * Replaces the flow's entire node/edge set in one shot — the simplest
 * correct way to persist what a visual canvas editor holds client-side,
 * rather than diffing adds/moves/deletes against the previous graph. Every
 * save gets fresh node/edge ids; nothing downstream depends on a node's id
 * staying stable across saves yet (the execution engine, which will care
 * about FlowSession.currentNodeId, is a later phase — see PROMPT follow-ups).
 */
export async function saveFlowGraph(flowId: string, nodes: FlowGraphNodeInput[], edges: FlowGraphEdgeInput[]) {
  const existing = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
  if (!existing) throw Errors.notFound("Fluxo nao encontrado");

  const clientIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!clientIds.has(edge.sourceNodeId) || !clientIds.has(edge.targetNodeId)) {
      throw Errors.badRequest("Uma aresta referencia um no que nao existe neste salvamento");
    }
  }
  if (!nodes.some((n) => n.type === "START")) {
    throw Errors.badRequest("O fluxo precisa ter um no de Inicio");
  }

  await prisma.$transaction(async (tx) => {
    await tx.flowEdge.deleteMany({ where: { flowId } });
    await tx.flowNode.deleteMany({ where: { flowId } });

    const idMap = new Map<string, string>();
    for (const node of nodes) {
      const created = await tx.flowNode.create({
        data: { flowId, type: node.type, positionX: node.positionX, positionY: node.positionY, data: (node.data ?? {}) as object },
        select: { id: true },
      });
      idMap.set(node.id, created.id);
    }

    if (edges.length > 0) {
      await tx.flowEdge.createMany({
        data: edges.map((edge) => ({
          flowId,
          sourceNodeId: idMap.get(edge.sourceNodeId)!,
          targetNodeId: idMap.get(edge.targetNodeId)!,
          sourceHandle: edge.sourceHandle ?? null,
        })),
      });
    }
  });

  return getFlowDetail(flowId);
}
