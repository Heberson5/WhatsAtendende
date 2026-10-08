import { Router } from "express";
import { z } from "zod";
import { PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import { assertScopeConnectionsExist } from "../../lib/connection-scope";
import * as service from "./satisfaction.service";

export const satisfactionRouter = Router();

satisfactionRouter.use(requireAuth, requirePermission(PERMISSION.RESPOSTAS_RAPIDAS_GERENCIAR));

satisfactionRouter.get(
  "/settings",
  requirePermission(PERMISSION.RESPOSTAS_PESQUISA_VISUALIZAR),
  asyncHandler(async (_req, res) => {
    res.json(await service.toSurveySettingsDTO(await service.getSurveySettings()));
  })
);

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    connectionScope: z.object({ allConnections: z.boolean(), connectionIds: z.array(z.string().uuid()).max(200) }),
    question: z.string().trim().min(1).max(1024),
    thanks: z.string().trim().min(1).max(1024),
    answerWindowHours: z.number().int().min(1).max(72),
    // A page loaded before this field existed doesn't send it — it gets the default rather than an error.
    closingWaitMinutes: z.number().int().min(1).max(720).default(service.DEFAULT_CLOSING_WAIT_MINUTES),
  })
  .refine((s) => !s.enabled || s.connectionScope.allConnections || s.connectionScope.connectionIds.length > 0, {
    message: "Escolha pelo menos uma conexão ou marque todas as conexões para ligar a pesquisa",
  })
  .refine((s) => s.closingWaitMinutes <= s.answerWindowHours * 60, {
    message: "A espera pela nota não pode ser maior que o tempo para o cliente responder a pesquisa",
    path: ["closingWaitMinutes"],
  });

satisfactionRouter.put(
  "/settings",
  requirePermission(PERMISSION.RESPOSTAS_PESQUISA_EDITAR),
  asyncHandler(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    await assertScopeConnectionsExist(input.connectionScope);
    const settings = await service.updateSurveySettings(input);
    await writeAudit({
      userId: req.auth!.userId,
      action: "SATISFACTION_SURVEY_UPDATED",
      entity: "SystemSetting",
      entityId: "satisfactionSurvey",
      ipAddress: req.ip ?? null,
      metadata: { enabled: input.enabled, connectionScope: input.connectionScope, answerWindowHours: input.answerWindowHours, closingWaitMinutes: input.closingWaitMinutes },
    });
    res.json(await service.toSurveySettingsDTO(settings));
  })
);
