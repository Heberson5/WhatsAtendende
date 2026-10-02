import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { validateFlowGraph } from "@whatsatendende/types";
import { FLOW_DETAIL_INCLUDE, FLOW_LIST_INCLUDE, toFlowEdgeDTO, toFlowNodeDTO } from "./flows.mapper";

export type FlowTemplate = "welcome" | "after-hours";

type TemplateNode = { key: string; type: "START" | "TEXT_MESSAGE" | "MENU" | "TRANSFER_TO_AGENT" | "END"; x: number; y: number; data: object };
type TemplateEdge = { from: string; to: string; handle?: string };

// Ready-made starting points offered on Fluxo's empty state.
const TEMPLATES: Record<FlowTemplate, { nodes: TemplateNode[]; edges: TemplateEdge[] }> = {
  welcome: {
    nodes: [
      { key: "start", type: "START", x: 60, y: 200, data: {} },
      { key: "hello", type: "TEXT_MESSAGE", x: 320, y: 200, data: { text: "Olá, {{cliente}}! 👋 Bem-vindo ao nosso atendimento." } },
      { key: "menu", type: "MENU", x: 600, y: 180, data: { options: [{ id: "opt-vendas", label: "Vendas" }, { id: "opt-suporte", label: "Suporte" }, { id: "opt-financeiro", label: "Financeiro" }] } },
      { key: "vendas", type: "TRANSFER_TO_AGENT", x: 900, y: 60, data: { assignedAgentIds: [], mode: "any" } },
      { key: "suporte", type: "TRANSFER_TO_AGENT", x: 900, y: 220, data: { assignedAgentIds: [], mode: "any" } },
      { key: "financeiro", type: "TRANSFER_TO_AGENT", x: 900, y: 380, data: { assignedAgentIds: [], mode: "any" } },
    ],
    edges: [
      { from: "start", to: "hello" },
      { from: "hello", to: "menu" },
      { from: "menu", to: "vendas", handle: "opt-vendas" },
      { from: "menu", to: "suporte", handle: "opt-suporte" },
      { from: "menu", to: "financeiro", handle: "opt-financeiro" },
    ],
  },
  "after-hours": {
    nodes: [
      { key: "start", type: "START", x: 60, y: 200, data: {} },
      {
        key: "closed",
        type: "TEXT_MESSAGE",
        x: 320,
        y: 200,
        data: { text: "Olá, {{cliente}}! No momento estamos fora do horário de atendimento. Sua mensagem foi registrada e responderemos assim que voltarmos." },
      },
      { key: "end", type: "END", x: 620, y: 200, data: {} },
    ],
    edges: [
      { from: "start", to: "closed" },
      { from: "closed", to: "end" },
    ],
  },
};

/** Refuses to leave a flow switched on while something in it is broken. */
function assertActivatable(nodes: Parameters<typeof validateFlowGraph>[0]["nodes"], edges: Parameters<typeof validateFlowGraph>[0]["edges"], connectionCount: number) {
  const issues = validateFlowGraph({ nodes, edges, connectionCount });
  if (issues.length > 0) {
    const shown = issues.slice(0, 3).map((i) => i.message).join("; ");
    throw Errors.badRequest(`O fluxo ativo precisa estar completo: ${shown}${issues.length > 3 ? ` (e mais ${issues.length - 3})` : ""}`);
  }
}

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
export async function createFlow(input: FlowMetaInput & { template?: FlowTemplate }, createdByUserId: string) {
  const connectionIds = input.connectionIds ?? [];
  await assertOfficialConnections(connectionIds);

  const flow = await prisma.flow.create({
    data: {
      name: input.name,
      description: input.description || null,
      createdByUserId,
      connections: { create: connectionIds.map((whatsappConnectionId) => ({ whatsappConnectionId })) },
      ...(input.template ? {} : { nodes: { create: [{ type: "START" as const, positionX: 80, positionY: 160, data: {} }] } }),
    },
    select: { id: true },
  });
  if (input.template) {
    const template = TEMPLATES[input.template];
    await saveFlowGraph(
      flow.id,
      template.nodes.map((n) => ({ id: n.key, type: n.type, positionX: n.x, positionY: n.y, data: n.data as Record<string, unknown> })),
      template.edges.map((e) => ({ sourceNodeId: e.from, targetNodeId: e.to, sourceHandle: e.handle ?? null }))
    );
  }
  return prisma.flow.findUniqueOrThrow({ where: { id: flow.id }, include: FLOW_LIST_INCLUDE });
}

/** A copy of a flow (graph and connections), always created switched off. */
export async function duplicateFlow(id: string, createdByUserId: string) {
  const source = await getFlowDetail(id);
  const copy = await prisma.flow.create({
    data: {
      name: `${source.name} (cópia)`.slice(0, 120),
      description: source.description,
      createdByUserId,
      connections: { create: source.connections.map((c) => ({ whatsappConnectionId: c.whatsappConnectionId })) },
    },
    select: { id: true },
  });
  await saveFlowGraph(
    copy.id,
    source.nodes.map((n) => ({ id: n.id, type: n.type, positionX: n.positionX, positionY: n.positionY, data: (n.data ?? {}) as Record<string, unknown> })),
    source.edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle }))
  );
  return prisma.flow.findUniqueOrThrow({ where: { id: copy.id }, include: FLOW_LIST_INCLUDE });
}

export async function updateFlowMeta(id: string, input: Partial<FlowMetaInput> & { active?: boolean }) {
  const existing = await prisma.flow.findUnique({ where: { id }, include: { nodes: true, edges: true, connections: true } });
  if (!existing) throw Errors.notFound("Fluxo nao encontrado");

  if (input.connectionIds) await assertOfficialConnections(input.connectionIds);
  const willBeActive = input.active ?? existing.active;
  if (willBeActive && (input.active === true || input.connectionIds)) {
    assertActivatable(existing.nodes.map(toFlowNodeDTO), existing.edges.map(toFlowEdgeDTO), (input.connectionIds ?? existing.connections).length);
  }

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
  const existing = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true, active: true, _count: { select: { connections: true } } } });
  if (!existing) throw Errors.notFound("Fluxo nao encontrado");
  if (existing.active) {
    assertActivatable(
      nodes.map((n) => ({ id: n.id, type: n.type, positionX: n.positionX, positionY: n.positionY, data: (n.data ?? {}) as never })),
      edges.map((e) => ({ sourceNodeId: e.sourceNodeId, sourceHandle: e.sourceHandle ?? null })),
      existing._count.connections
    );
  }

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
