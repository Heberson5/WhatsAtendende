import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import type { Role } from "@prisma/client";

const withConnection = { whatsappConnection: true } as const;

/** AGENT requires a home WhatsApp connection (which queue they see); ADMIN/MANAGER never have one — they see everything via oversight. */
async function resolveConnectionAssignment(role: Role, whatsappConnectionId: string | null | undefined): Promise<string | null> {
  if (role !== "AGENT") return null;
  if (!whatsappConnectionId) throw Errors.badRequest("Selecione a conexao de WhatsApp deste atendente");
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: whatsappConnectionId } });
  if (!connection) throw Errors.badRequest("Conexao de WhatsApp invalida");
  return whatsappConnectionId;
}

export async function listUsers() {
  return prisma.user.findMany({ orderBy: { fullName: "asc" }, include: withConnection });
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: withConnection });
  if (!user) throw Errors.notFound("Usuario nao encontrado");
  return user;
}

export async function createUser(input: {
  fullName: string;
  displayName: string;
  email: string;
  password: string;
  role: Role;
  whatsappConnectionId?: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing) throw Errors.conflict("Ja existe um usuario com este e-mail");

  const whatsappConnectionId = await resolveConnectionAssignment(input.role, input.whatsappConnectionId);
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: {
      fullName: input.fullName,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
      whatsappConnectionId,
    },
    include: withConnection,
  });
}

export async function updateUser(
  id: string,
  input: Partial<{ fullName: string; displayName: string; email: string; role: Role; whatsappConnectionId: string | null }>
) {
  const current = await getUser(id);
  const nextRole = input.role ?? current.role;
  // Re-validated whenever the role or the connection itself changes — not
  // just once at creation — so an AGENT can never end up without one, and
  // a promoted ADMIN/MANAGER always has it cleared.
  const whatsappConnectionId =
    "role" in input || "whatsappConnectionId" in input
      ? await resolveConnectionAssignment(nextRole, input.whatsappConnectionId ?? current.whatsappConnectionId)
      : undefined;

  return prisma.user.update({
    where: { id },
    data: {
      ...input,
      email: input.email ? input.email.toLowerCase() : undefined,
      whatsappConnectionId,
    },
    include: withConnection,
  });
}

export async function setUserStatus(id: string, status: "ACTIVE" | "INACTIVE") {
  await getUser(id);
  return prisma.user.update({ where: { id }, data: { status }, include: withConnection });
}

export async function resetUserPassword(id: string): Promise<{ temporaryPassword: string }> {
  await getUser(id);
  const temporaryPassword = crypto.randomBytes(6).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }),
  ]);
  return { temporaryPassword };
}
