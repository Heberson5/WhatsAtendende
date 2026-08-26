import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const BRANDING_KEY = "branding";

export interface BrandingSettings {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

const DEFAULT_BRANDING: BrandingSettings = {
  companyName: "WhatsAtendende",
  primaryColor: "#0097B4",
  secondaryColor: "#FFE450",
  logoUrl: null,
  faviconUrl: null,
};

export async function getBranding(): Promise<BrandingSettings> {
  const record = await prisma.systemSetting.findUnique({ where: { key: BRANDING_KEY } });
  return record ? { ...DEFAULT_BRANDING, ...(record.value as object) } : DEFAULT_BRANDING;
}

export async function updateBranding(patch: Partial<BrandingSettings>): Promise<BrandingSettings> {
  const current = await getBranding();
  const next = { ...current, ...patch };
  await prisma.systemSetting.upsert({
    where: { key: BRANDING_KEY },
    update: { value: next as unknown as Prisma.InputJsonValue },
    create: { key: BRANDING_KEY, value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function getBusinessSettings(): Promise<Record<string, unknown>> {
  const record = await prisma.systemSetting.findUnique({ where: { key: "business" } });
  return (record?.value as Record<string, unknown> | undefined) ?? DEFAULT_BUSINESS_SETTINGS;
}

// Roadmap knobs (spec section 52/53): not all are enforced by business
// logic yet, but the settings store and API already support them so the
// enforcement can land without a schema/API break.
const DEFAULT_BUSINESS_SETTINGS = {
  // Now enforced client-side (see useIdleLogout) — 8h covers a full shift
  // without ever tripping mid-workday; an admin can tune it in Configurações.
  inactivityTimeoutMinutes: 8 * 60,
  autoCloseEnabled: false,
  reopenTarget: "QUEUE", // QUEUE | LAST_AGENT
  uploadMaxSizeMb: 25,
  notificationSoundEnabled: true,
  businessHours: null as { start: string; end: string; days: number[] } | null,
  greetingMessage: null as string | null,
  awayMessage: null as string | null,
};

export async function updateBusinessSettings(patch: Record<string, unknown>) {
  const current = await getBusinessSettings();
  const next = { ...current, ...patch };
  await prisma.systemSetting.upsert({
    where: { key: "business" },
    update: { value: next as unknown as Prisma.InputJsonValue },
    create: { key: "business", value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function setUserThemePreference(userId: string, theme: "LIGHT" | "DARK" | "AUTO") {
  await prisma.user.update({ where: { id: userId }, data: { themePreference: theme } });
}

// ---------------------------------------------------------------------------
// SMTP / e-mail delivery (used for password-reset links) — section 5/56.
// ---------------------------------------------------------------------------

const EMAIL_KEY = "email";

export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (typically port 465); false = STARTTLS/plaintext (587/25)
  username: string | null;
  password: string | null;
  fromName: string;
  fromEmail: string;
}

export type EmailSettingsMasked = Omit<EmailSettings, "password"> & { configured: boolean; hasPassword: boolean };

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  host: "",
  port: 587,
  secure: false,
  username: null,
  password: null,
  fromName: "WhatsAtendende",
  fromEmail: "",
};

/** Internal — includes the password. Never expose this to an HTTP response; use getEmailSettingsMasked instead. */
export async function getEmailSettings(): Promise<EmailSettings | null> {
  const record = await prisma.systemSetting.findUnique({ where: { key: EMAIL_KEY } });
  if (!record) return null;
  return { ...DEFAULT_EMAIL_SETTINGS, ...(record.value as Partial<EmailSettings>) };
}

/** Safe to return to the client: the password is never echoed back, only whether one is set. */
export async function getEmailSettingsMasked(): Promise<EmailSettingsMasked> {
  const settings = (await getEmailSettings()) ?? DEFAULT_EMAIL_SETTINGS;
  const { password, ...rest } = settings;
  return { ...rest, configured: Boolean(settings.host && settings.fromEmail), hasPassword: Boolean(password) };
}

export async function updateEmailSettings(patch: Partial<EmailSettings>): Promise<EmailSettingsMasked> {
  const current = (await getEmailSettings()) ?? DEFAULT_EMAIL_SETTINGS;
  const next: EmailSettings = {
    host: patch.host ?? current.host,
    port: patch.port ?? current.port,
    secure: patch.secure ?? current.secure,
    username: patch.username !== undefined ? patch.username : current.username,
    // Only overwrite the stored password when a new non-empty one is sent,
    // so the admin can edit host/port without retyping it — and the API
    // never sends it back, so there's nothing to "leave unchanged" from a form value.
    password: patch.password ? patch.password : current.password,
    fromName: patch.fromName ?? current.fromName,
    fromEmail: patch.fromEmail ?? current.fromEmail,
  };
  await prisma.systemSetting.upsert({
    where: { key: EMAIL_KEY },
    update: { value: next as unknown as Prisma.InputJsonValue },
    create: { key: EMAIL_KEY, value: next as unknown as Prisma.InputJsonValue },
  });
  return getEmailSettingsMasked();
}
