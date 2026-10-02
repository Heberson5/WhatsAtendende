import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSION } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { UnsavedChangesBar } from "../../components/common/UnsavedChangesBar";
import { useAuthStore } from "../../store/auth-store";

interface BusinessSettings {
  queueReminderIntervalMinutes?: number;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 60; // matches the backend's zod schema

export function FilaSettingsPanel() {
  const queryClient = useQueryClient();
  const canEditar = useAuthStore((s) => s.permissions?.[PERMISSION.CONFIGURACOES_FILA_EDITAR]);
  // Shares the "business-settings" query key with SecuritySettingsPanel —
  // both read the same underlying SystemSetting "business" bag, just
  // different fields of it.
  const { data } = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => (await api.get<BusinessSettings>("/settings/business")).data,
  });

  const [minutes, setMinutes] = useState(1);
  useEffect(() => {
    if (data?.queueReminderIntervalMinutes) setMinutes(data.queueReminderIntervalMinutes);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/settings/queue", { queueReminderIntervalMinutes: minutes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      toast.success("Intervalo de lembrete da fila salvo.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="shadow-soft max-w-xl space-y-6 rounded-card border border-border bg-surface p-6">
      <div>
        <h2 className="text-base font-semibold">Lembrete de fila</h2>
        <p className="mt-1 text-sm text-muted">
          Enquanto houver conversas aguardando para serem aceitas, os atendentes online da conexão são notificados
          repetidamente neste intervalo. Atendentes pausados ou offline não recebem o lembrete.
        </p>
      </div>

      <label className="block max-w-xs">
        <span className="mb-1 block text-sm font-medium">Repetir lembrete a cada (minutos)</span>
        <input
          type="number"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={1}
          value={minutes}
          disabled={!canEditar}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
        />
      </label>

      {canEditar && (
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)}
          className="focus-ring rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
        >
          Salvar configuração
        </button>
      )}
      {canEditar && data && (
        <UnsavedChangesBar
          dirty={data.queueReminderIntervalMinutes !== undefined && minutes !== data.queueReminderIntervalMinutes}
          saving={saveMutation.isPending}
          canSave={minutes >= MIN_MINUTES && minutes <= MAX_MINUTES}
          onSave={() => saveMutation.mutate()}
          onDiscard={() => setMinutes(data.queueReminderIntervalMinutes ?? 1)}
        />
      )}
    </div>
  );
}
