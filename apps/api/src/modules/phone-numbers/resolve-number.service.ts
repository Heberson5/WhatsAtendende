import { normalizeTypedPhone } from "@whatsatendende/types";
import { logger } from "../../lib/logger";
import * as whatsappService from "../whatsapp/whatsapp.service";
import { getPhoneSettings } from "./phone-settings.service";

export interface ResolvedNumber {
  /** What to use: the number WhatsApp knows, or — when it doesn't know any form, or couldn't be asked — the typed number after the settings' rules. */
  phone: string;
  /** The typed number after the settings' rules, before asking WhatsApp. */
  normalized: string;
  /** true/false when WhatsApp answered; null when it couldn't be asked right now. */
  exists: boolean | null;
}

/** Asks WhatsApp about each form of the number in turn; the first one it knows wins, and its own spelling of the number is what comes back. */
async function confirmWithWhatsApp(connectionId: string, normalized: string, alternates: string[]): Promise<ResolvedNumber> {
  let answered = false;
  for (const candidate of [normalized, ...alternates]) {
    try {
      const found = await whatsappService.lookupNumber(connectionId, candidate);
      answered = true;
      if (found) return { phone: found.phone, normalized, exists: true };
    } catch (err) {
      logger.warn({ err, connectionId }, "could not ask WhatsApp whether a number exists");
    }
  }
  return { phone: normalized, normalized, exists: answered ? false : null };
}

/** For the number being typed in Nova conversa: applies the settings, then confirms the number (and, if the 9 was dropped, its other form) on WhatsApp. */
export async function resolveTypedNumber(connectionId: string, typed: string): Promise<ResolvedNumber> {
  const { phone, alternates } = normalizeTypedPhone(typed, await getPhoneSettings());
  return confirmWithWhatsApp(connectionId, phone, alternates);
}

/**
 * For actually starting the conversation. WhatsApp is only asked when there is
 * a doubt — a number whose 9 was dropped has two forms; any other number is
 * used as it came out of the rules, with no extra lookup, as before.
 */
export async function resolveNumberToStart(connectionId: string, typed: string): Promise<{ phone: string; confirmedOnWhatsApp: boolean }> {
  const { phone, alternates } = normalizeTypedPhone(typed, await getPhoneSettings());
  if (alternates.length === 0) return { phone, confirmedOnWhatsApp: false };
  const resolved = await confirmWithWhatsApp(connectionId, phone, alternates);
  return { phone: resolved.phone, confirmedOnWhatsApp: resolved.exists === true };
}
