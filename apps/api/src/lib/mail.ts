import nodemailer from "nodemailer";
import { logger } from "./logger";
import { getEmailSettings } from "../modules/settings/settings.service";

export interface SendMailResult {
  sent: boolean;
  reason?: string;
}

/**
 * Sends an e-mail through the SMTP server configured in Configurações > E-mail.
 * Returns `{ sent: false }` (never throws) when SMTP isn't configured yet or
 * the send fails, so callers (e.g. password reset) can fall back gracefully
 * instead of turning an e-mail outage into a 500 for the whole request.
 */
export async function sendMail(to: string, subject: string, html: string, text: string): Promise<SendMailResult> {
  const settings = await getEmailSettings();
  if (!settings || !settings.host || !settings.fromEmail) {
    return { sent: false, reason: "SMTP nao configurado" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.username ? { user: settings.username, pass: settings.password ?? undefined } : undefined,
    });
    await transporter.sendMail({
      from: `"${settings.fromName}" <${settings.fromEmail}>`,
      to,
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (err) {
    logger.error({ err }, "failed to send e-mail via SMTP");
    return { sent: false, reason: "Falha ao enviar e-mail pelo servidor SMTP configurado" };
  }
}
