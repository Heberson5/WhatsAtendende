import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { toUserDTO } from "./users.mapper";
import * as usersService from "./users.service";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole("ADMIN"));

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
    const user = await usersService.setUserStatus(req.params.id, "ACTIVE");
    await writeAudit({ userId: req.auth!.userId, action: "USER_ACTIVATED", entity: "User", entityId: user.id, ipAddress: req.ip ?? null });
    res.json(toUserDTO(user));
  })
);

usersRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const user = await usersService.setUserStatus(req.params.id, "INACTIVE");
    await writeAudit({ userId: req.auth!.userId, action: "USER_DEACTIVATED", entity: "User", entityId: user.id, ipAddress: req.ip ?? null });
    res.json(toUserDTO(user));
  })
);

usersRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const result = await usersService.resetUserPassword(req.params.id);
    await writeAudit({ userId: req.auth!.userId, action: "USER_PASSWORD_RESET_BY_ADMIN", entity: "User", entityId: req.params.id, ipAddress: req.ip ?? null });
    // Returned once, out-of-band delivery (e-mail) is a documented follow-up — see README roadmap.
    res.json(result);
  })
);
