import { Router, type Request } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { Errors } from "../../lib/http-error";
import { realtimeEvents } from "../../realtime/realtime";
import { toUserDTO } from "./users.mapper";
import * as usersService from "./users.service";

export const usersRouter = Router();

usersRouter.use(requireAuth, requirePermission(PERMISSION.USUARIOS_GERENCIAR));

// USUARIOS_GERENCIAR can be granted to a MANAGER, unlike every other
// permission gate in this file, which is a real capability change: a
// delegated (non-ADMIN) user manager must never be able to create a new
// ADMIN, promote anyone to ADMIN, or touch an existing ADMIN account —
// otherwise granting this one permission would be an unbounded privilege
// escalation. A true ADMIN caller is exempt from all of this.
async function assertNoAdminEscalation(req: Request, targetUserId?: string, requestedRole?: string) {
  if (req.auth!.role === "ADMIN") return;
  if (requestedRole === "ADMIN") throw Errors.forbidden("Somente um administrador pode conceder o perfil Administrador");
  if (targetUserId) {
    const target = await usersService.getUser(targetUserId);
    if (target.role === "ADMIN") throw Errors.forbidden("Somente um administrador pode gerenciar outra conta de Administrador");
  }
}

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await usersService.listUsers();
    res.json(users.map(toUserDTO));
  })
);

const createSchema = z.object({
  fullName: z.string().min(2),
  displayName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "AGENT"]),
  // Required for role=AGENT (validated in the service, since it depends on
  // the role also present in this same payload); ignored for ADMIN/MANAGER.
  whatsappConnectionId: z.string().uuid().nullable().optional(),
});

usersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    if (input.password !== input.confirmPassword) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "As senhas nao coincidem" });
    }
    await assertNoAdminEscalation(req, undefined, input.role);
    const user = await usersService.createUser(input);
    await writeAudit({ userId: req.auth!.userId, action: "USER_CREATED", entity: "User", entityId: user.id, ipAddress: req.ip ?? null, metadata: { email: user.email, role: user.role } });
    res.status(201).json(toUserDTO(user));
  })
);

const updateSchema = z.object({
  fullName: z.string().min(2).optional(),
  displayName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "MANAGER", "AGENT"]).optional(),
  whatsappConnectionId: z.string().uuid().nullable().optional(),
  password: z.string().min(8).optional(),
  confirmPassword: z.string().min(8).optional(),
});

usersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { confirmPassword, ...input } = updateSchema.parse(req.body);
    if (input.password && input.password !== confirmPassword) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "As senhas nao coincidem" });
    }
    await assertNoAdminEscalation(req, req.params.id, input.role);
    const user = await usersService.updateUser(req.params.id, input);
    await writeAudit({
      userId: req.auth!.userId,
      action: "USER_UPDATED",
      entity: "User",
      entityId: user.id,
      ipAddress: req.ip ?? null,
      metadata: { ...input, password: input.password ? "[alterada]" : undefined },
    });
    res.json(toUserDTO(user));
  })
);

usersRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    await assertNoAdminEscalation(req, req.params.id);
    const user = await usersService.setUserStatus(req.params.id, "ACTIVE");
    await writeAudit({ userId: req.auth!.userId, action: "USER_ACTIVATED", entity: "User", entityId: user.id, ipAddress: req.ip ?? null });
    res.json(toUserDTO(user));
  })
);

usersRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    await assertNoAdminEscalation(req, req.params.id);
    const user = await usersService.setUserStatus(req.params.id, "INACTIVE");
    await writeAudit({ userId: req.auth!.userId, action: "USER_DEACTIVATED", entity: "User", entityId: user.id, ipAddress: req.ip ?? null });
    res.json(toUserDTO(user));
  })
);

usersRouter.post(
  "/:id/force-logout",
  asyncHandler(async (req, res) => {
    await assertNoAdminEscalation(req, req.params.id);
    await usersService.forceLogoutUser(req.params.id);
    realtimeEvents.userForceLoggedOut(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "USER_FORCE_LOGGED_OUT", entity: "User", entityId: req.params.id, ipAddress: req.ip ?? null });
    res.status(204).end();
  })
);

usersRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    await assertNoAdminEscalation(req, req.params.id);
    const result = await usersService.resetUserPassword(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "USER_PASSWORD_RESET_BY_ADMIN", entity: "User", entityId: req.params.id, ipAddress: req.ip ?? null });
    // Returned once, out-of-band delivery (e-mail) is a documented follow-up — see README roadmap.
    res.json(result);
  })
);
