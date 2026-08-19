import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  WHATSAPP_PROVIDER: z.enum(["mock", "baileys"]).default("mock"),
  WHATSAPP_AUTH_DIR: z.string().default("./whatsapp-sessions"),
  WEB_APP_URL: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("./uploads"),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().default(25),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
});

export const env = schema.parse(process.env);
