import type { AutoMessageTrigger } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";

export async function listAutoMessageTemplates(trigger?: AutoMessageTrigger) {
  return prisma.autoMessageTemplate.findMany({
    where: trigger ? { trigger } : undefined,
    orderBy: { name: "asc" },
  });
}

export async function getAutoMessageTemplate(id: string) {
  const row = await prisma.autoMessageTemplate.findUnique({ where: { id } });
  if (!row) throw Errors.notFound("Mensagem automatica nao encontrada");
  return row;
}

export interface AutoMessageTemplateInput {
  trigger: AutoMessageTrigger;
  name: string;
  text: string;
  active: boolean;
}

export async function createAutoMessageTemplate(input: AutoMessageTemplateInput) {
  return prisma.autoMessageTemplate.create({ data: input });
}

export async function updateAutoMessageTemplate(id: string, input: Partial<AutoMessageTemplateInput>) {
  await getAutoMessageTemplate(id);
  return prisma.autoMessageTemplate.update({ where: { id }, data: input });
}

export async function deleteAutoMessageTemplate(id: string) {
  await getAutoMessageTemplate(id);
  await prisma.autoMessageTemplate.delete({ where: { id } });
}

/**
 * The template actually used when a trigger fires — the most recently
 * updated ACTIVE row for it, or null when none is configured/active (the
 * trigger is then a no-op, same as before this feature existed). More than
 * one active row can exist (nothing stops a manager from keeping a couple
 * around), but only one message ever goes out per event, so this is the
 * single, deterministic pick.
 */
export async function getActiveTemplateFor(trigger: AutoMessageTrigger) {
  return prisma.autoMessageTemplate.findFirst({ where: { trigger, active: true }, orderBy: { updatedAt: "desc" } });
}

const TAGS = { atendente: /\{\{\s*atendente\s*\}\}/gi, cliente: /\{\{\s*cliente\s*\}\}/gi };

/** Substitutes {{atendente}}/{{cliente}} with real values — see AutoMessageTemplate's own doc comment. */
export function renderAutoMessageTemplate(text: string, vars: { atendente: string; cliente: string }): string {
  return text.replace(TAGS.atendente, vars.atendente).replace(TAGS.cliente, vars.cliente);
}
