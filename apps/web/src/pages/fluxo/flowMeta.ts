import { Flag, List, MessageSquareText, UserCheck2, type LucideIcon } from "lucide-react";
import type { FlowNodeType } from "@whatsatendende/types";

/** Label, icon and color of each node type — shared by the list thumbnails and the editor. */
export const NODE_META: Record<FlowNodeType, { label: string; icon: LucideIcon; color: string }> = {
  START: { label: "Início", icon: Flag, color: "#0097B4" },
  TEXT_MESSAGE: { label: "Mensagem de texto", icon: MessageSquareText, color: "#2563EB" },
  MENU: { label: "Menu de opções", icon: List, color: "#7C3AED" },
  TRANSFER_TO_AGENT: { label: "Transferir para atendente", icon: UserCheck2, color: "#059669" },
  END: { label: "Fim", icon: Flag, color: "#DC2626" },
};

export type FlowTemplate = "welcome" | "after-hours";

export const FLOW_TEMPLATES: { key: FlowTemplate; name: string; description: string }[] = [
  { key: "welcome", name: "Boas-vindas com setores", description: "Cumprimenta o cliente e oferece um menu (Vendas, Suporte, Financeiro) que leva ao atendente certo." },
  { key: "after-hours", name: "Fora do horário", description: "Avisa que o atendimento está fechado e registra a mensagem para o próximo expediente." },
];
