import type { ClosingMessageDTO } from "@whatsatendende/types";
import { toConnectionScopeDTO } from "../../lib/connection-scope";

interface ClosingMessageRow {
  id: string;
  name: string;
  text: string;
  active: boolean;
  assignedUsers: { id: string; displayName: string }[];
  allConnections: boolean;
  connections: { id: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export function toClosingMessageDTO(row: ClosingMessageRow): ClosingMessageDTO {
  return {
    id: row.id,
    name: row.name,
    text: row.text,
    active: row.active,
    assignedUsers: row.assignedUsers,
    connectionScope: toConnectionScopeDTO(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
