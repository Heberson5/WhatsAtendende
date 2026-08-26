import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "../../lib/api";

interface BusinessSettings {
  inactivityTimeoutMinutes?: number;
}

const MIN_HOURS = 1 / 60; // matches the backend's 1-minute floor
const MAX_HOURS = 24; // matches the backend's 1440-minute ceiling

export function SecuritySettingsPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => (await api.get<BusinessSettings>("/settings/business")).data,
  });

  // Stored in minutes on the backend (inactivityTimeoutMinutes, shared with
  // the client-side idle-logout timer — see useIdleLogout), shown here in
  // hours per PROMPT: "inativo por xx horas".
  const [hours, setHours] = useState(8);

  useEffect(() => {
    if (data?.inactivityTimeoutMinutes) setHours(Number((data.inactivityTimeoutMinutes / 60).toFixed(2)));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/settings/business", { inactivityTimeoutMinutes: Math.round(hours * 60) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      toast.success("Tempo de inatividade salvo.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="shadow-soft max-w-xl space-y-6 rounded-card border border-border bg-surface p-6">
      <div>
        <h2 className="text-base font-semibold">Sessão</h2>
        <p className="mt-1 text-sm text-muted">
          Cada usuário só pode ter uma sessão ativa por vez — um novo login em outro local ou dispositivo encerra
          automaticamente a sessão anterior. Fechar o navegador também encerra a sessão. Abaixo, defina após quantas
          horas sem nenhuma atividade uma sessão aberta é encerrada automaticamente.
        </p>
      </div>

      <label className="block max-w-xs">
        <span className="mb-1 block text-sm font-medium">Logoff automático por inatividade (horas)</span>
        <input
          type="number"
          min={MIN_HOURS}
          max={MAX_HOURS}
          step={0.5}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || !(hours >= MIN_HOURS && hours <= MAX_HOURS)}
        className="focus-ring rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
      >
        Salvar configuração
      </button>
    </div>
  );
}
