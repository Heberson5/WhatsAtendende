import type { Prisma } from "@prisma/client";
import type { FlowDetailDTO, FlowEdgeDTO, FlowListItemDTO, FlowNodeData, FlowNodeDTO, FlowNodeType } from "@whatsatendende/types";

const flowListInclude = {
  connections: { include: { whatsappConnection: { select: { id: true, name: true } } } },
  createdBy: { select: { displayName: true } },
  _count: { select: { nodes: true } },
} satisfies Prisma.FlowInclude;

type FlowListRow = Prisma.FlowGetPayload<{ include: typeof flowListInclude }>;

const flowDetailInclude = {
  ...flowListInclude,
  nodes: true,
  edges: true,
} satisfies Prisma.FlowInclude;

type FlowDetailRow = Prisma.FlowGetPayload<{ include: typeof flowDetailInclude }>;

export const FLOW_LIST_INCLUDE = flowListInclude;
export const FLOW_DETAIL_INCLUDE = flowDetailInclude;

export function toFlowListItemDTO(row: FlowListRow): FlowListItemDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    connectionIds: row.connections.map((c) => c.whatsappConnectionId),
    connectionNames: row.connections.map((c) => c.whatsappConnection.name),
    nodeCount: row._count.nodes,
    createdByUserName: row.createdBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toFlowNodeDTO(row: { id: string; type: string; positionX: number; positionY: number; data: Prisma.JsonValue }): FlowNodeDTO {
  return {
    id: row.id,
    type: row.type as FlowNodeType,
    positionX: row.positionX,
    positionY: row.positionY,
    data: (row.data ?? {}) as FlowNodeData,
  };
}

export function toFlowEdgeDTO(row: { id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string | null }): FlowEdgeDTO {
  return { id: row.id, sourceNodeId: row.sourceNodeId, targetNodeId: row.targetNodeId, sourceHandle: row.sourceHandle };
}

export function toFlowDetailDTO(row: FlowDetailRow): FlowDetailDTO {
  return {
    ...toFlowListItemDTO(row),
    nodes: row.nodes.map(toFlowNodeDTO),
    edges: row.edges.map(toFlowEdgeDTO),
  };
}
