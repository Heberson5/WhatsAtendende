import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken } from "../modules/auth/jwt";
import { isSessionActive } from "../lib/session";
import { Errors } from "../lib/http-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // sessionId: the RefreshToken row behind the access token (its `sid`), set by requireAuth.
      auth?: { userId: string; role: Role; displayName: string; sessionId?: string };
      // Raw request body bytes, captured by express.json()'s `verify`
      // callback in app.ts — needed to check the Meta webhook's
      // X-Hub-Signature-256 (an HMAC over the exact bytes received, which
      // the already-parsed/re-serialized JSON object can't reproduce
      // reliably). Undefined for any route whose content-type isn't JSON.
      rawBody?: Buffer;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(Errors.unauthorized());

  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    // See lib/session.ts — without this, a device logged out by a second
    // login elsewhere keeps working on every REST call until this token's
    // own (short) TTL happens to expire, not the instant the other device
    // logged in — see PROMPT: "não poderá acessar 2x ou mais simultaneamente".
    if (!(await isSessionActive(payload.sid))) {
      return next(Errors.unauthorized("Sessao encerrada — login realizado em outro dispositivo"));
    }
    req.auth = { userId: payload.sub, role: payload.role, displayName: payload.displayName, sessionId: payload.sid };
    next();
  } catch {
    next(Errors.unauthorized("Token invalido ou expirado"));
  }
}

/** Restricts a route to one or more roles. Always used server-side — never rely on the frontend to hide a route. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Errors.unauthorized());
    if (!roles.includes(req.auth.role)) return next(Errors.forbidden());
    next();
  };
}
