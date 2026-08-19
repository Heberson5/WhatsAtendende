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
  inactivityTimeoutMinutes: 30,
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
