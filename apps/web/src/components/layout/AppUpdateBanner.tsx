import { useState } from "react";
import { Download, X } from "lucide-react";
import { useBranding } from "../../hooks/useBranding";
import { isStandalone } from "../../hooks/useInstallPrompt";

const DISMISSED_VERSION_KEY = "appUpdateNoticeDismissedVersion";

/**
 * Tells already-installed users the app's icon/name changed and they need
 * to reinstall to see it — the OS-level icon/label is frozen at install
 * time and never updates on its own (Android or Windows). Only shown to
 * people actually running the installed app (isStandalone), and only until
 * they dismiss this specific version — never shown at all if no
 * appVersion is set. See PROMPT: "avisar os usuários que tem uma nova
 * versão e que precisa ser reinstalado... se já foi atualizado,
 * desconsiderar".
 */
export function AppUpdateBanner() {
  const { data: branding } = useBranding();
  const [dismissedVersion, setDismissedVersion] = useState(() => localStorage.getItem(DISMISSED_VERSION_KEY));

  const version = branding?.appVersion?.trim();
  if (!version || !isStandalone() || dismissedVersion === version) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_VERSION_KEY, version as string);
    setDismissedVersion(version as string);
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-secondary/20 px-4 py-2 text-sm">
      <Download className="h-4 w-4 shrink-0 text-text" />
      <p className="flex-1 text-text">
        O ícone e o nome do aplicativo foram atualizados (versão {version}). Para ver a versão nova, desinstale e instale o
        aplicativo novamente. Se você já atualizou, pode ignorar este aviso.
      </p>
      <button type="button" onClick={dismiss} className="focus-ring shrink-0 rounded-full p-1 text-text hover:bg-surface-alt" aria-label="Dispensar aviso">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
