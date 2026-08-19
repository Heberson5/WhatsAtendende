export * from "./types";
export { MockWhatsAppProvider } from "./MockWhatsAppProvider";
export { BaileysWhatsAppProvider } from "./BaileysWhatsAppProvider";
export type { BaileysProviderOptions } from "./BaileysWhatsAppProvider";

import type { WhatsAppProvider } from "./types";
import { MockWhatsAppProvider } from "./MockWhatsAppProvider";
import { BaileysWhatsAppProvider } from "./BaileysWhatsAppProvider";

export interface CreateProviderOptions {
  provider: "mock" | "baileys";
  authStateDir?: string;
}

/** Factory: the only place in the app that knows concrete provider classes exist. */
export function createWhatsAppProvider(options: CreateProviderOptions): WhatsAppProvider {
  if (options.provider === "baileys") {
    return new BaileysWhatsAppProvider({ authStateDir: options.authStateDir ?? "./whatsapp-sessions" });
  }
  return new MockWhatsAppProvider();
}
