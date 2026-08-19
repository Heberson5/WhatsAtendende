import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { env } from "../../config/env";
import * as service from "./settings.service";

export const settingsRouter = Router();

const brandingAssetDir = path.join(env.UPLOAD_DIR, "branding");
fs.mkdirSync(brandingAssetDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!["image/png", "image/jpeg", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"].includes(file.mimetype)) {
      return cb(new Error("Formato de imagem nao suportado"));
    }
    cb(null, true);
  },
});

// Public: the login screen needs the logo/colors before the user authenticates.
settingsRouter.get(
  "/branding",
  asyncHandler(async (_req, res) => {
    res.json(await service.getBranding());
  })
);

settingsRouter.use(requireAuth);

const brandingSchema = z.object({
  companyName: z.string().min(1).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

settingsRouter.patch(
  "/branding",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const patch = brandingSchema.parse(req.body);
    const branding = await service.updateBranding(patch);
    await writeAudit({ userId: req.auth!.userId, action: "SETTINGS_BRANDING_UPDATED", entity: "SystemSetting", entityId: "branding", ipAddress: req.ip ?? null, metadata: patch });
    res.json(branding);
  })
);

settingsRouter.post(
  "/branding/logo",
  requireRole("ADMIN"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "BAD_REQUEST", message: "Nenhum arquivo enviado" });
    const fileName = `logo-${randomUUID()}${path.extname(req.file.originalname)}`;
    fs.writeFileSync(path.join(brandingAssetDir, fileName), req.file.buffer);
    const branding = await service.updateBranding({ logoUrl: `/uploads/branding/${fileName}` });
    await writeAudit({ userId: req.auth!.userId, action: "SETTINGS_LOGO_UPLOADED", entity: "SystemSetting", entityId: "branding", ipAddress: req.ip ?? null });
    res.json(branding);
  })
);

settingsRouter.post(
  "/branding/favicon",
  requireRole("ADMIN"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "BAD_REQUEST", message: "Nenhum arquivo enviado" });
    const fileName = `favicon-${randomUUID()}${path.extname(req.file.originalname)}`;
    fs.writeFileSync(path.join(brandingAssetDir, fileName), req.file.buffer);
    const branding = await service.updateBranding({ faviconUrl: `/uploads/branding/${fileName}` });
    await writeAudit({ userId: req.auth!.userId, action: "SETTINGS_FAVICON_UPLOADED", entity: "SystemSetting", entityId: "branding", ipAddress: req.ip ?? null });
    res.json(branding);
  })
);

settingsRouter.get(
  "/business",
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json(await service.getBusinessSettings());
  })
);

settingsRouter.patch(
  "/business",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const settings = await service.updateBusinessSettings(req.body ?? {});
    await writeAudit({ userId: req.auth!.userId, action: "SETTINGS_BUSINESS_UPDATED", entity: "SystemSetting", entityId: "business", ipAddress: req.ip ?? null, metadata: req.body });
    res.json(settings);
  })
);

const themeSchema = z.object({ theme: z.enum(["LIGHT", "DARK", "AUTO"]) });
settingsRouter.patch(
  "/theme",
  asyncHandler(async (req, res) => {
    const { theme } = themeSchema.parse(req.body);
    await service.setUserThemePreference(req.auth!.userId, theme);
    res.json({ theme });
  })
);
