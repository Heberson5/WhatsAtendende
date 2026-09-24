import type { AutoMessageTemplate } from "@prisma/client";
import type { AutoMessageTemplateDTO } from "@whatsatendende/types";

export function toAutoMessageTemplateDTO(row: AutoMessageTemplate): AutoMessageTemplateDTO {
  return {
    id: row.id,
    trigger: row.trigger,
    name: row.name,
    text: row.text,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
