import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { writeAudit } from "../../lib/audit";
import { sendTemplatedMail } from "../../lib/mail";
import { clearPendingTransferDeadlines } from "../conversations/conversations.service";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt";
import { env } from "../../config/env";
import { realtimeEvents } from "../../realtime/realtime";

const REFRESH_TOKEN_DAYS = 7;

// Never a real bcrypt hash of any real password — used only to make the
// "user not found" path do roughly the same amount of CPU work as the
// "wrong password" path, so response timing can't be used to enumerate
// which e-mails have an account (see login()).
const DUMMY_PASSWORD_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8i8ymOGvyaP9GkYb2xTHMqxlBLXX9m";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function login(email: string, password: string, ip: string | null) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { whatsappConnection: true } });
  if (!user) {
    // Do the same bcrypt work a real lookup would, so a non-existent e-mail
    // doesn't respond measurably faster than a wrong password for a real
    // one — otherwise response time alone lets an attacker enumerate valid accounts.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw Errors.unauthorized("E-mail ou senha invalidos");
  }

  if (user.status === "INACTIVE") {
    await writeAudit({ userId: user.id, action: "LOGIN_BLOCKED_INACTIVE", entity: "User", entityId: user.id, ipAddress: ip });
    throw Errors.forbidden("Usuario inativo. Contate um administrador.");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await writeAudit({ userId: user.id, action: "LOGIN_FAILED", entity: "User", entityId: user.id, ipAddress: ip });
    throw Errors.unauthorized("E-mail ou senha invalidos");
  }

  // Only one active login at a time — see PROMPT: o usuário não pode logar
  // mais de uma vez. Revoking here (never deleting — keeps the audit trail
  // via each row's own timestamps) happens BEFORE this login mints its own
  // token below, so it never revokes itself. If a live session was actually
  // open (revoked something), also kill it instantly — see
  // realtimeEvents.userForceLoggedOut.
  const revoked = await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role, displayName: user.displayName });
  const refreshToken = signRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  if (revoked.count > 0) {
    realtimeEvents.userForceLoggedOut(user.id, "NEW_LOGIN");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastAccessAt: new Date(), presence: "ONLINE" } });
  await writeAudit({ userId: user.id, action: "LOGIN_SUCCESS", entity: "User", entityId: user.id, ipAddress: ip });
  // Logging in proves this agent is back — cancels the 2h auto-revert
  // countdown on any conversation transferred to them while offline.
  await clearPendingTransferDeadlines(user.id);

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

  const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { whatsappConnection: true } });
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

export async function requestPasswordReset(email: string): Promise<{ token: string; emailSent: boolean } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Always behave the same way regardless of whether the user exists, to
  // avoid leaking which e-mails are registered (both in the response body
  // and, approximately, in timing — see the dummy work on the not-found path).
  if (!user || user.status === "INACTIVE") {
    crypto.randomBytes(32);
    return null;
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await writeAudit({ userId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id });

  const resetLink = `${env.WEB_APP_URL}/reset-password?token=${token}`;
  const { sent } = await sendTemplatedMail("PASSWORD_RESET", user.email, {
    nome: user.displayName,
    link_redefinicao: resetLink,
  });

  // The raw token is still returned to the caller — the route only surfaces
  // it in the API response outside production, and only when the e-mail
  // itself couldn't be sent (SMTP not configured yet), so the reset flow
  // stays testable without depending on a mail server.
  return { token, emailSent: sent };
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
    // Secure must match how the app is actually served, not just NODE_ENV:
    // a production deploy without its own TLS termination (e.g. this app's
    // own docker-compose, published as plain http://<vps-ip>:8080) has
    // browsers silently refuse to send a `Secure` cookie back, so every
    // /auth/refresh call 401s and a page reload bounces the user to login.
    // WEB_APP_URL already reflects the real public scheme (it's also used
    // for CORS), so key off that instead of assuming production == https.
    secure: env.WEB_APP_URL.startsWith("https://"),
    // strict, not lax: this app has no legitimate cross-site entry point
    // (no OAuth redirect back into it, no external link needs the cookie
    // attached), so there's no reason to allow it on cross-site navigation
    // — and strict also closes the (already-narrow, since refresh/logout
    // are POST) CSRF surface on the cookie-authenticated auth routes entirely.
    sameSite: "strict" as const,
    path: "/api/auth",
    // No maxAge/expires — a session cookie, not a persistent one. See
    // PROMPT: fechar o navegador deve encerrar a sessão automaticamente.
    // The browser drops it once the browser itself (not just the tab) is
    // closed, so useBootstrapSession's silent refresh on next open finds
    // nothing to send and the user lands back on /login. The refresh
    // token's own REFRESH_TOKEN_DAYS server-side expiry stays as a second,
    // independent ceiling regardless of how long the cookie itself survives.
  };
}
