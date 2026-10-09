import type { Prisma, ReleaseNoteVersion, Role } from "@prisma/client";
import { compareVersions, visibleReleases, type PermissionMap, type ReleaseContent, type ReleaseDTO, type ReleaseNoteDTO } from "@whatsatendende/types";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../lib/http-error";
import { logger } from "../../lib/logger";
import { DEFAULT_RELEASES } from "./default-releases";

// The shipped versions already copied into the database (see syncDefaultReleaseNotes).
const DEFAULTS_KEY = "releaseNotesDefaults";

function toReleaseDTO(row: ReleaseNoteVersion): ReleaseDTO {
  return { id: row.id, version: row.version, date: row.date, name: row.name, summary: row.summary, notes: row.notes as unknown as ReleaseNoteDTO[] };
}

function toData(content: ReleaseContent) {
  return { version: content.version, date: content.date, name: content.name, summary: content.summary, notes: content.notes as unknown as Prisma.InputJsonValue };
}

/** Every version, the newest first (by number, not by when it was written). */
export async function listReleases(): Promise<ReleaseDTO[]> {
  const rows = await prisma.releaseNoteVersion.findMany();
  return rows.map(toReleaseDTO).sort((a, b) => compareVersions(b.version, a.version));
}

/** The versions as this person sees them — only the notes about screens they can open. */
export async function listVisibleReleases(role: Role, permissions: PermissionMap): Promise<ReleaseDTO[]> {
  return visibleReleases(await listReleases(), role, permissions);
}

async function getRelease(id: string): Promise<ReleaseNoteVersion> {
  const row = await prisma.releaseNoteVersion.findUnique({ where: { id } });
  if (!row) throw Errors.notFound("Versão não encontrada");
  return row;
}

async function assertVersionFree(version: string, exceptId?: string): Promise<void> {
  const existing = await prisma.releaseNoteVersion.findUnique({ where: { version }, select: { id: true } });
  if (existing && existing.id !== exceptId) throw Errors.conflict(`Já existe a versão ${version}. Edite essa versão ou use outro número.`);
}

export async function createRelease(content: ReleaseContent): Promise<ReleaseDTO> {
  await assertVersionFree(content.version);
  return toReleaseDTO(await prisma.releaseNoteVersion.create({ data: toData(content) }));
}

export async function updateRelease(id: string, content: ReleaseContent): Promise<ReleaseDTO> {
  await getRelease(id);
  await assertVersionFree(content.version, id);
  return toReleaseDTO(await prisma.releaseNoteVersion.update({ where: { id }, data: toData(content) }));
}

export async function deleteRelease(id: string): Promise<ReleaseDTO> {
  const row = await getRelease(id);
  await prisma.releaseNoteVersion.delete({ where: { id } });
  return toReleaseDTO(row);
}

/**
 * Copies the versions shipped with the system (default-releases.ts) into the database — each one once. A version
 * an administrator deleted is not brought back, an edited one is not overwritten, and a version shipped later is
 * added on the next start. Called when the server starts.
 */
export async function syncDefaultReleaseNotes(defaults: ReleaseContent[] = DEFAULT_RELEASES): Promise<number> {
  const record = await prisma.systemSetting.findUnique({ where: { key: DEFAULTS_KEY } });
  const copied = new Set((record?.value as { versions?: string[] } | undefined)?.versions ?? []);
  const missing = defaults.filter((r) => !copied.has(r.version));
  if (missing.length === 0) return 0;

  let added = 0;
  for (const release of missing) {
    // Already written in Configurações with the same number: that one stays.
    const exists = await prisma.releaseNoteVersion.findUnique({ where: { version: release.version }, select: { id: true } });
    if (!exists) {
      await prisma.releaseNoteVersion.create({ data: toData(release) });
      added++;
    }
    copied.add(release.version);
  }
  const value = { versions: [...copied] } as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key: DEFAULTS_KEY }, update: { value }, create: { key: DEFAULTS_KEY, value } });
  if (added > 0) logger.info({ added }, "release notes shipped with this version copied into the database");
  return added;
}
