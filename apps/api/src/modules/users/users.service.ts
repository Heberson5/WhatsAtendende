import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import type { Role } from "@prisma/client";

export async function listUsers() {
  return prisma.user.findMany({ orderBy: { fullName: "asc" } });
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw Errors.notFound("Usuario nao encontrado");
  return user;
}

export async function createUser(input: {
  fullName: string;
  displayName: string;
  email: string;
  password: string;
  role: Role;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing) throw Errors.conflict("Ja existe um usuario com este e-mail");

  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: {
      fullName: input.fullName,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
    },
  });
}

export async function updateUser(
  id: string,
  input: Partial<{ fullName: string; displayName: string; email: string; role: Role }>
) {
  await getUser(id);
  return prisma.user.update({
    where: { id },
    data: { ...input, email: input.email ? input.email.toLowerCase() : undefined },
  });
}

export async function setUserStatus(id: string, status: "ACTIVE" | "INACTIVE") {
  await getUser(id);
  return prisma.user.update({ where: { id }, data: { status } });
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
