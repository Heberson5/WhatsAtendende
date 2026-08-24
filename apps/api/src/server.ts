import http from "node:http";
import { createApp } from "./app";
import { createSocketServer } from "./realtime/socket-server";
import { initWhatsAppConnections, shutdownAllConnections } from "./modules/whatsapp/whatsapp.service";
import { revertExpiredTransfers } from "./modules/conversations/conversations.service";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";

const TRANSFER_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // see PROMPT: revert an unaccepted offline transfer after 2h

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  await initWhatsAppConnections();

  const transferSweepTimer = setInterval(() => {
    revertExpiredTransfers().catch((err) => logger.error({ err }, "failed to sweep expired transfers"));
  }, TRANSFER_SWEEP_INTERVAL_MS);
  transferSweepTimer.unref(); // never keeps the process alive by itself

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT} (env=${env.NODE_ENV}, whatsapp=${env.WHATSAPP_PROVIDER})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(transferSweepTimer);
    httpServer.close();
    // Every deploy sends this signal to the outgoing container — ending
    // each WhatsApp connection's socket cleanly here (rather than letting
    // the process just die under it) avoids corrupting WhatsApp's own
    // multi-device sync to the linked phone. See shutdownAllConnections.
    await shutdownAllConnections();
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
