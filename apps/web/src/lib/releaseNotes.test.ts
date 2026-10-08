import { describe, it, expect } from "vitest";
import { PERMISSION, type PermissionMap, type Role } from "@whatsatendende/types";
import { RELEASES, compareVersions, visibleReleases } from "./releaseNotes";

const ALL_PERMISSIONS = Object.fromEntries(Object.values(PERMISSION).map((p) => [p, true])) as PermissionMap;

// The screenshots shipped with the app (public/notas-de-versao), by name.
const SHIPPED_IMAGES = new Set(Object.keys(import.meta.glob("/public/notas-de-versao/*.webp")).map((path) => path.split("/").pop()!.replace(/\.webp$/, "")));

const presentationNote = (role: Role) =>
  visibleReleases(role, ALL_PERMISSIONS)
    .flatMap((r) => r.notes)
    .find((n) => n.title === "Apresentação de PowerPoint para a diretoria");

describe("notas de versão", () => {
  it("a apresentação do Dashboard aparece para gestores e administradores, e não para atendentes — nem com acesso ao Dashboard", () => {
    expect(presentationNote("ADMIN")).toBeDefined();
    expect(presentationNote("MANAGER")).toBeDefined();
    expect(presentationNote("AGENT")).toBeUndefined();
  });

  it("um atendente não recebe aviso de versão nova só com notas de gestão", () => {
    expect(visibleReleases("MANAGER", ALL_PERMISSIONS)[0].version).toBe("2.2.0");
    expect(visibleReleases("AGENT", ALL_PERMISSIONS)[0].version).not.toBe("2.2.0");
  });

  it("um gestor sem acesso ao Dashboard não lê sobre o botão do Dashboard", () => {
    const withoutDashboard = { ...ALL_PERMISSIONS, [PERMISSION.DASHBOARD_ACESSAR]: false };
    const notes = visibleReleases("MANAGER", withoutDashboard).flatMap((r) => r.notes);
    expect(notes.find((n) => n.title === "Apresentação de PowerPoint para a diretoria")).toBeUndefined();
  });

  it("toda imagem citada numa nota existe na pasta das notas de versão", () => {
    const missing = RELEASES.flatMap((r) => r.notes.flatMap((n) => n.images ?? []))
      .map((image) => image.file)
      .filter((file) => !SHIPPED_IMAGES.has(file));
    expect(missing).toEqual([]);
  });

  it("as versões estão da mais nova para a mais antiga, sem repetir", () => {
    for (let i = 1; i < RELEASES.length; i++) expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
  });
});
