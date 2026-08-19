import http from "node:http";
import { createApp } from "./app";
import { createSocketServer } from "./realtime/socket-server";
import { initWhatsAppProvider } from "./modules/whatsapp/whatsapp.service";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  await initWhatsAppProvider();

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT} (env=${env.NODE_ENV}, whatsapp=${env.WHATSAPP_PROVIDER})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
