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

// ---------------------------------------------------------------------------
// E-mail templates (HTML + subject + on/off) for the system's automatic
// e-mails — password reset, new-user welcome, account-deactivated notice.
// ---------------------------------------------------------------------------

export type EmailTemplateType = "PASSWORD_RESET" | "USER_WELCOME" | "USER_DEACTIVATED";

export interface EmailTemplateConfig {
  enabled: boolean;
  subject: string;
  html: string;
}

export type EmailTemplatesSettings = Record<EmailTemplateType, EmailTemplateConfig>;

const EMAIL_TEMPLATES_KEY = "emailTemplates";

// Shared table-based layout (works in Outlook/Gmail/etc, unlike flexbox/grid
// e-mail markup) — {{logo_html}}/{{empresa}}/{{cor_primaria}}/{{ano}} are
// always resolved from Configurações > Identidade visual at send time (see
// sendTemplatedMail in mail.ts), so every template stays on-brand for
// whichever company runs this platform without hardcoding any of it here.
function baseTemplateHtml(titleText: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{empresa}}</title>
</head>
<body style="margin:0; padding:30px 0; width:100%; background-color:#F4F5F7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F5F7; border-collapse:collapse;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px; background-color:#ffffff; border-radius:8px; border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:32px 24px 8px;">{{logo_html}}</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0; font-family:Helvetica,Arial,sans-serif; font-size:19px; font-weight:600; text-align:center; color:{{cor_primaria}};">
              ${titleText}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 32px; font-family:Helvetica,Arial,sans-serif; font-size:14px; line-height:24px; color:#2E363F; text-align:justify;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px; border-top:1px solid #EEEEEE; font-family:Helvetica,Arial,sans-serif; font-size:12px; color:#9AA1A9; text-align:center;">
              &copy; {{ano}} {{empresa}}. Todos os direitos reservados.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const DEFAULT_EMAIL_TEMPLATES: EmailTemplatesSettings = {
  PASSWORD_RESET: {
    enabled: true,
    subject: "Redefinição de senha - {{empresa}}",
    html: baseTemplateHtml(
      "Redefinição de senha",
      `<p>Olá, {{nome}}.</p>
       <p>Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para continuar (o link é válido por 1 hora):</p>
       <p style="text-align:center; padding:12px 0;"><a href="{{link_redefinicao}}" style="display:inline-block; background-color:{{cor_primaria}}; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:600;">Redefinir senha</a></p>
       <p style="font-size:12px; color:#9AA1A9;">Se o botão não funcionar, copie e cole este link no navegador: {{link_redefinicao}}</p>
       <p>Se você não solicitou essa alteração, ignore este e-mail — sua senha permanece a mesma.</p>`
    ),
  },
  USER_WELCOME: {
    enabled: true,
    subject: "Bem-vindo(a) à {{empresa}}",
    html: baseTemplateHtml(
      "Bem-vindo(a)!",
      `<p>Olá, {{nome}}.</p>
       <p>Sua conta foi criada em {{empresa}}. Você já pode acessar a plataforma com o e-mail <strong>{{email}}</strong>.</p>
       <p style="text-align:center; padding:12px 0;"><a href="{{link_login}}" style="display:inline-block; background-color:{{cor_primaria}}; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:600;">Acessar plataforma</a></p>`
    ),
  },
  USER_DEACTIVATED: {
    enabled: true,
    subject: "Sua conta foi desativada - {{empresa}}",
    html: baseTemplateHtml(
      "Conta desativada",
      `<p>Olá, {{nome}}.</p>
       <p>Sua conta em {{empresa}} foi desativada por um administrador. Se você acredita que isso é um engano, entre em contato com o time responsável.</p>`
    ),
  },
};

/** Tags specific to each template type — surfaced in the editor UI so the admin knows what's available. */
export const EMAIL_TEMPLATE_TAGS: Record<EmailTemplateType, { tag: string; description: string }[]> = {
  PASSWORD_RESET: [
    { tag: "{{nome}}", description: "Nome de exibição do usuário" },
    { tag: "{{link_redefinicao}}", description: "Link único para redefinir a senha (expira em 1 hora)" },
  ],
  USER_WELCOME: [
    { tag: "{{nome}}", description: "Nome de exibição do novo usuário" },
    { tag: "{{email}}", description: "E-mail de login do novo usuário" },
    { tag: "{{link_login}}", description: "Link para a tela de login" },
  ],
  USER_DEACTIVATED: [{ tag: "{{nome}}", description: "Nome de exibição do usuário desativado" }],
};

/** Available in every template regardless of type — resolved automatically from Identidade visual. */
export const EMAIL_TEMPLATE_COMMON_TAGS: { tag: string; description: string }[] = [
  { tag: "{{empresa}}", description: "Nome da empresa (Configurações > Identidade visual)" },
  { tag: "{{logo_html}}", description: "Logo da empresa — ou o nome da empresa em texto, se nenhuma logo foi enviada" },
  { tag: "{{cor_primaria}}", description: "Cor primária configurada em Identidade visual" },
  { tag: "{{ano}}", description: "Ano atual" },
];

export async function getEmailTemplates(): Promise<EmailTemplatesSettings> {
  const record = await prisma.systemSetting.findUnique({ where: { key: EMAIL_TEMPLATES_KEY } });
  const stored = (record?.value as Partial<EmailTemplatesSettings>) ?? {};
  return {
    PASSWORD_RESET: { ...DEFAULT_EMAIL_TEMPLATES.PASSWORD_RESET, ...stored.PASSWORD_RESET },
    USER_WELCOME: { ...DEFAULT_EMAIL_TEMPLATES.USER_WELCOME, ...stored.USER_WELCOME },
    USER_DEACTIVATED: { ...DEFAULT_EMAIL_TEMPLATES.USER_DEACTIVATED, ...stored.USER_DEACTIVATED },
  };
}

export async function updateEmailTemplate(type: EmailTemplateType, patch: Partial<EmailTemplateConfig>): Promise<EmailTemplatesSettings> {
  const current = await getEmailTemplates();
  const next: EmailTemplatesSettings = { ...current, [type]: { ...current[type], ...patch } };
  await prisma.systemSetting.upsert({
    where: { key: EMAIL_TEMPLATES_KEY },
    update: { value: next as unknown as Prisma.InputJsonValue },
    create: { key: EMAIL_TEMPLATES_KEY, value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}
