import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { writeAudit } from "../../lib/audit";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt";
import { env } from "../../config/env";

const REFRESH_TOKEN_DAYS = 7;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function login(email: string, password: string, ip: string | null) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw Errors.unauthorized("E-mail ou senha invalidos");

  if (user.status === "INACTIVE") {
    await writeAudit({ userId: user.id, action: "LOGIN_BLOCKED_INACTIVE", entity: "User", entityId: user.id, ipAddress: ip });
    throw Errors.forbidden("Usuario inativo. Contate um administrador.");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await writeAudit({ userId: user.id, action: "LOGIN_FAILED", entity: "User", entityId: user.id, ipAddress: ip });
    throw Errors.unauthorized("E-mail ou senha invalidos");
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role, displayName: user.displayName });
  const refreshToken = signRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastAccessAt: new Date(), presence: "ONLINE" } });
  await writeAudit({ userId: user.id, action: "LOGIN_SUCCESS", entity: "User", entityId: user.id, ipAddress: ip });

  return { accessToken, refreshToken, user };
}

export async function refresh(refreshToken: string) {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Errors.unauthorized("Sessao expirada, faca login novamente");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Errors.unauthorized("Sessao expirada, faca login novamente");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status === "INACTIVE") throw Errors.unauthorized("Sessao invalida");

  // Rotate refresh token to limit replay window.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const newRefreshToken = signRefreshToken(user.id);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, displayName: user.displayName });
  return { accessToken, refreshToken: newRefreshToken, user };
}

export async function logout(refreshToken: string | undefined, userId: string, ip: string | null) {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revokedAt: new Date() },
    });
  }
  await prisma.user.update({ where: { id: userId }, data: { presence: "OFFLINE" } }).catch(() => undefined);
  await writeAudit({ userId, action: "LOGOUT", entity: "User", entityId: userId, ipAddress: ip });
}

export async function requestPasswordReset(email: string): Promise<{ token: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Always behave the same way regardless of whether the user exists, to
  // avoid leaking which e-mails are registered.
  if (!user || user.status === "INACTIVE") return null;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await writeAudit({ userId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id });

  // In production this token would be delivered via e-mail. Delivery is out
  // of scope for this environment; the token is returned to the caller so
  // the API's own docs/tests can exercise the full reset flow.
  return { token };
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw Errors.badRequest("Link de redefinicao invalido ou expirado");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId }, data: { revokedAt: new Date() } }),
  ]);
  await writeAudit({ userId: record.userId, action: "PASSWORD_RESET_COMPLETED", entity: "User", entityId: record.userId });
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  };
}
