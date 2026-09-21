import { useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { useBranding } from "../../hooks/useBranding";

const DISMISSED_AT_KEY = "installPromptDismissedAt";
// Re-offered after a few days rather than never again — someone who
// dismissed it once on a rushed login may still want the app later, and a
// permanent dismissal would mean an install invite that only ever shows
// exactly once per browser, forever.
const RESHOW_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function wasRecentlyDismissed(): boolean {
  const raw = localStorage.getItem(DISMISSED_AT_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  return !Number.isNaN(dismissedAt) && Date.now() - dismissedAt < RESHOW_AFTER_MS;
}

/**
 * Shown on the login screen (before any credentials are entered) inviting
 * the visitor to install the app first — see PROMPT: "ao acessar pelo
 * navegador do celular, não está aparecendo um pop up para instalar o app
 * antes de fazer o login, isso tem que aparecer no computador também".
 * Reuses the same useInstallPrompt as the in-app Topbar button (Chrome/Edge
 * desktop and Android get the real native install dialog; iOS gets manual
 * "Compartilhar > Adicionar à Tela de Início" instructions instead, since
 * Safari never fires beforeinstallprompt at all).
 */
export function InstallPromptModal() {
  const { data: branding } = useBranding();
  const { installed, canPromptInstall, isIosManual, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => wasRecentlyDismissed());

  // canPromptInstall/isIosManual can both start false and flip true a beat
  // later (the beforeinstallprompt event fires asynchronously after page
  // load) — re-checking dismissal here would be pointless since it's a pure
  // localStorage read, so this only needs the modal to actually mount once
  // that happens; no extra effect required beyond the hook's own state.

  function dismiss() {
    localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    setDismissed(true);
  }

  function handleInstall() {
    if (canPromptInstall) {
      promptInstall();
      dismiss();
      return;
    }
    toast.info('Para instalar: toque no ícone de Compartilhar e depois em "Adicionar à Tela de Início".', { duration: 8000 });
    dismiss();
  }

  if (installed || dismissed || (!canPromptInstall && !isIosManual)) return null;

  const appName = branding?.appName ?? branding?.companyName ?? "o aplicativo";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="shadow-elevated w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Download className="h-6 w-6" />
          </div>
          <button type="button" onClick={dismiss} className="focus-ring rounded-full p-1 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-4 text-base font-semibold">Instalar {appName}</h2>
        <p className="mt-1.5 text-sm text-muted">
          Instale para abrir direto da tela inicial ou da área de trabalho, sem precisar do navegador — é mais rápido e funciona como um
          aplicativo de verdade.
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={dismiss} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
            Agora não
          </button>
          <button
            type="button"
            onClick={handleInstall}
            className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg"
          >
            Instalar
          </button>
        </div>
      </div>
    </div>
  );
}
