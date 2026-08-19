import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error";
import { logger } from "../lib/logger";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Dados invalidos",
      details: err.flatten(),
    });
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err }, "request failed");
    return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  }

  logger.error({ err, path: req.path }, "unhandled error");
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno do servidor" });
}
