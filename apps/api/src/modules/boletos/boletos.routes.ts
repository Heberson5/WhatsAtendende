import { Router } from "express";
import { z } from "zod";
import { BOLETO_INSTRUCTION_LINE_MAX_LENGTH, BOLETO_INSTRUCTION_LINES_MAX, PERMISSION } from "@whatsatendende/types";
import { asyncHandler } from "../../lib/async-handler";
import { requireAuth } from "../../middleware/auth";
import { requirePermission } from "../../lib/permissions";
import { writeAudit } from "../../lib/audit";
import * as service from "./boletos.service";

/** Configurações › Fontes de dados › Boletos: a bank only sends boletos after matching 3 real ones. */
export const boletosRouter = Router();
boletosRouter.use(requireAuth);

boletosRouter.get(
  "/validation",
  requirePermission(PERMISSION.FONTES_DADOS_VER),
  asyncHandler(async (_req, res) => {
    res.json(await service.getValidation());
  })
);

const sampleSchema = z.object({ ourNumber: z.string().trim().min(1).max(40), linha: z.string().trim().min(44).max(80) });
boletosRouter.post(
  "/validation",
  requirePermission(PERMISSION.FONTES_DADOS_EDITAR),
  asyncHandler(async (req, res) => {
    const { ourNumber, linha } = sampleSchema.parse(req.body);
    try {
      res.json(await service.submitValidationSample(ourNumber, linha));
    } finally {
      await writeAudit({ userId: req.auth!.userId, action: "BOLETO_VALIDATION_SAMPLE", entity: "SystemSetting", entityId: "boleto-validation", ipAddress: req.ip ?? null, metadata: { ourNumber } });
    }
  })
);

boletosRouter.delete(
  "/validation/:bank",
  requirePermission(PERMISSION.FONTES_DADOS_EDITAR),
  asyncHandler(async (req, res) => {
    const result = await service.resetValidation(req.params.bank);
    await writeAudit({ userId: req.auth!.userId, action: "BOLETO_VALIDATION_RESET", entity: "SystemSetting", entityId: "boleto-validation", ipAddress: req.ip ?? null, metadata: { bank: req.params.bank } });
    res.json(result);
  })
);

boletosRouter.get(
  "/instructions",
  requirePermission(PERMISSION.FONTES_DADOS_VER),
  asyncHandler(async (_req, res) => {
    res.json(await service.getInstructions());
  })
);

const percent = z.number().min(0).max(100);
const instructionsSchema = z.object({
  finePercent: percent,
  interestMonthPercent: percent,
  lines: z.array(z.string().trim().min(1).max(BOLETO_INSTRUCTION_LINE_MAX_LENGTH)).max(BOLETO_INSTRUCTION_LINES_MAX),
});
boletosRouter.put(
  "/instructions",
  requirePermission(PERMISSION.FONTES_DADOS_EDITAR),
  asyncHandler(async (req, res) => {
    const instructions = await service.setInstructions(instructionsSchema.parse(req.body));
    await writeAudit({ userId: req.auth!.userId, action: "BOLETO_INSTRUCTIONS_UPDATED", entity: "SystemSetting", entityId: "boleto-instructions", ipAddress: req.ip ?? null, metadata: { ...instructions } });
    res.json(instructions);
  })
);
