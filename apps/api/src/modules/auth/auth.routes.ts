import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { requireAuth } from "../../middleware/auth";
import { toUserDTO } from "../users/users.mapper";
import * as authService from "./auth.service";
import { refreshCookieOptions } from "./auth.service";
import { prisma } from "../../lib/prisma";
import { getPermissionsForRole } from "../../lib/permissions";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// Password-reset endpoints are unauthenticated by nature — without their
// own limiter they'd let an attacker spam e-mails to arbitrary addresses
// (forgot-password) or brute-force reset tokens (reset-password).
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { accessToken, refreshToken, user } = await authService.login(email, password, req.ip ?? null);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    res.json({ accessToken, user: toUserDTO(user), permissions: await getPermissionsForRole(user.role) });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) return res.status(401).json({ error: "UNAUTHORIZED", message: "Sessao nao encontrada" });
    const { accessToken, refreshToken, user } = await authService.refresh(token);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    res.json({ accessToken, user: toUserDTO(user), permissions: await getPermissionsForRole(user.role) });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken as string | undefined;
    await authService.logout(token, req.auth!.userId, req.ip ?? null);
    res.clearCookie("refreshToken", { path: "/api/auth" });
    res.status(204).end();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include: { whatsappConnection: true } });
    res.json({ ...toUserDTO(user), permissions: await getPermissionsForRole(user.role) });
  })
);

const forgotSchema = z.object({ email: z.string().email() });
authRouter.post(
  "/forgot-password",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotSchema.parse(req.body);
    const result = await authService.requestPasswordReset(email);
    // Response is intentionally identical whether or not the e-mail exists.
    // devToken is only surfaced outside production, and only when SMTP
    // isn't configured (so the e-mail genuinely wasn't sent) — once e-mail
    // delivery works, the token never appears in the API response.
    res.json({
      message: "Se o e-mail existir, um link de redefinicao foi enviado.",
      devToken: env.NODE_ENV !== "production" && !result?.emailSent ? result?.token : undefined,
    });
  })
);

const resetSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });
authRouter.post(
  "/reset-password",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = resetSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ message: "Senha redefinida com sucesso." });
  })
);
