import type { AutoMessageTrigger, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { appliesToConnection, assertScopeConnectionsExist, scopeData, withScopeConnections, type ConnectionScopeInput } from "../../lib/connection-scope";

export async function listAutoMessageTemplates(trigger?: AutoMessageTrigger) {
  return prisma.autoMessageTemplate.findMany({
    where: trigger ? { trigger } : undefined,
    orderBy: { name: "asc" },
    include: withScopeConnections,
  });
}

export async function getAutoMessageTemplate(id: string) {
  const row = await prisma.autoMessageTemplate.findUnique({ where: { id }, include: withScopeConnections });
  if (!row) throw Errors.notFound("Mensagem automatica nao encontrada");
  return row;
}

export interface AutoMessageTemplateInput {
  trigger: AutoMessageTrigger;
  name: string;
  text: string;
  active: boolean;
  connectionScope: ConnectionScopeInput;
}

export async function createAutoMessageTemplate({ connectionScope, ...input }: AutoMessageTemplateInput) {
  await assertScopeConnectionsExist(connectionScope);
  return prisma.autoMessageTemplate.create({ data: { ...input, ...scopeData(connectionScope, "connect") }, include: withScopeConnections });
}

export async function updateAutoMessageTemplate(id: string, { connectionScope, ...input }: Partial<AutoMessageTemplateInput>) {
  await getAutoMessageTemplate(id);
  if (connectionScope) await assertScopeConnectionsExist(connectionScope);
  return prisma.autoMessageTemplate.update({
    where: { id },
    data: { ...input, ...(connectionScope && scopeData(connectionScope, "set")) },
    include: withScopeConnections,
  });
}

export async function deleteAutoMessageTemplate(id: string) {
  await getAutoMessageTemplate(id);
  await prisma.autoMessageTemplate.delete({ where: { id } });
}

/**
 * The template actually used when a trigger fires on a conversation of this
 * connection — the most recently updated ACTIVE row for it, preferring one
 * picked specifically for the connection over an "all connections" one, or
 * null when none applies (the trigger is then a no-op). More than one active
 * row can exist, but only one message ever goes out per event.
 */
export async function getActiveTemplateFor(trigger: AutoMessageTrigger, whatsappConnectionId: string | null) {
  const rows = await prisma.autoMessageTemplate.findMany({
    where: { trigger, active: true, ...appliesToConnection(whatsappConnectionId) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.find((r) => !r.allConnections) ?? rows[0] ?? null;
}

const TAGS = {
  atendente: /\{\{\s*atendente\s*\}\}/gi,
  atendenteNome: /\{\{\s*atendente_nome\s*\}\}/gi,
  atendenteCargo: /\{\{\s*atendente_cargo\s*\}\}/gi,
  cliente: /\{\{\s*cliente\s*\}\}/gi,
};

// See PROMPT: "quero que tenha as tags do cadastro do usuário" — used by
// {{atendente_cargo}} below, and reused as-is by closing-messages.service.ts
// for the Encerramento message, which shares this same tag set.
export const ROLE_LABEL: Record<Role, string> = { AGENT: "Atendente", MANAGER: "Gestor", ADMIN: "Administrador" };

export interface AutoMessageTemplateVars {
  /** Nome de exibição — kept as the {{atendente}} tag for templates saved before the tags below existed. */
  atendente: string;
  /** Nome completo cadastrado no usuário — {{atendente_nome}}. */
  atendenteNome: string;
  /** Cargo do usuário (Atendente/Gestor/Administrador) — {{atendente_cargo}}. */
  atendenteCargo: string;
  cliente: string;
}

/** Substitutes {{atendente}}/{{atendente_nome}}/{{atendente_cargo}}/{{cliente}} with real values — see AutoMessageTemplate's own doc comment. */
export function renderAutoMessageTemplate(text: string, vars: AutoMessageTemplateVars): string {
  return text
    .replace(TAGS.atendente, vars.atendente)
    .replace(TAGS.atendenteNome, vars.atendenteNome)
    .replace(TAGS.atendenteCargo, vars.atendenteCargo)
    .replace(TAGS.cliente, vars.cliente);
}
