import { useCallback, useMemo } from "react";
import { api } from "../lib/api";
import { compareVersions, visibleReleases } from "../lib/releaseNotes";
import { useAuthStore } from "../store/auth-store";

/**
 * Notas de versão as this user sees them (only the areas they can access),
 * plus whether there's a release they haven't opened yet — which drives the
 * sidebar's "Novo" badge and the one-time "O que há de novo" popup.
 */
export function useReleaseNotes() {
  const role = useAuthStore((s) => s.user?.role);
  const seenVersion = useAuthStore((s) => s.user?.releaseNotesSeenVersion ?? null);
  const permissions = useAuthStore((s) => s.permissions);
  const updateReleaseNotesSeen = useAuthStore((s) => s.updateReleaseNotesSeen);

  const releases = useMemo(() => (role && permissions ? visibleReleases(role, permissions) : []), [role, permissions]);
  const latest = releases[0] ?? null;
  const hasUnseen = latest !== null && (seenVersion === null || compareVersions(latest.version, seenVersion) > 0);

  const markSeen = useCallback(() => {
    if (!latest || !hasUnseen) return;
    updateReleaseNotesSeen(latest.version);
    api.patch("/profile/release-notes-seen", { version: latest.version }).catch(() => updateReleaseNotesSeen(seenVersion));
  }, [latest, hasUnseen, seenVersion, updateReleaseNotesSeen]);

  return { releases, latest, hasUnseen, markSeen };
}
