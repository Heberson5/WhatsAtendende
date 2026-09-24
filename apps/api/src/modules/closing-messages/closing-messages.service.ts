import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";

const withAssignedUsers = { assignedUsers: { select: { id: true, displayName: true }, orderBy: { displayName: "asc" as const } } } as const;

export async function listClosingMessages() {
  return prisma.closingMessage.findMany({ orderBy: { name: "asc" }, include: withAssignedUsers });
}

export async function getClosingMessage(id: string) {
  const row = await prisma.closingMessage.findUnique({ where: { id }, include: withAssignedUsers });
  if (!row) throw Errors.notFound("Encerramento nao encontrado");
  return row;
}

/**
 * The only place userIds are ever attached/detached from a ClosingMessage
 * — reassigns exactly the given set, moving anyone in it away from
 * whatever ClosingMessage they were in before (a plain overwrite of
 * User.closingMessageId, one row per user, so exclusivity is automatic —
 * see PROMPT: "se habilitar o usuário no recente, irá sair do anterior")
 * and detaching anyone previously on this one who isn't in the new set.
 */
async function syncAssignedUsers(closingMessageId: string, userIds: string[]) {
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: { in: userIds } }, data: { closingMessageId } }),
    prisma.user.updateMany({ where: { closingMessageId, id: { notIn: userIds } }, data: { closingMessageId: null } }),
  ]);
}

export interface ClosingMessageInput {
  name: string;
  text: string;
  active: boolean;
  userIds: string[];
}

async function assertUsersExist(userIds: string[]) {
  if (userIds.length === 0) return;
  const count = await prisma.user.count({ where: { id: { in: userIds } } });
  if (count !== userIds.length) throw Errors.badRequest("Um ou mais usuarios selecionados sao invalidos");
}

export async function createClosingMessage(input: ClosingMessageInput) {
  await assertUsersExist(input.userIds);
  const row = await prisma.closingMessage.create({ data: { name: input.name, text: input.text, active: input.active } });
  await syncAssignedUsers(row.id, input.userIds);
  return getClosingMessage(row.id);
}

export async function updateClosingMessage(id: string, input: Partial<ClosingMessageInput>) {
  await getClosingMessage(id);
  if (input.userIds) await assertUsersExist(input.userIds);
  await prisma.closingMessage.update({
    where: { id },
    data: { name: input.name, text: input.text, active: input.active },
  });
  if (input.userIds) await syncAssignedUsers(id, input.userIds);
  return getClosingMessage(id);
}

export async function deleteClosingMessage(id: string) {
  await getClosingMessage(id);
  await prisma.closingMessage.delete({ where: { id } });
}

/** The message to auto-send when this user clicks Encerrar — null if they have none assigned, or theirs is inactive. */
export async function getActiveClosingMessageForAgent(agentId: string) {
  const user = await prisma.user.findUnique({ where: { id: agentId }, select: { closingMessage: true } });
  if (!user?.closingMessage || !user.closingMessage.active) return null;
  return user.closingMessage;
}
