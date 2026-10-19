import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PERMISSION } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { UnsavedChangesBar } from "../../components/common/UnsavedChangesBar";
import { useAuthStore } from "../../store/auth-store";
import { DEFAULT_ALERT_THRESHOLDS, type AlertThresholds } from "../../hooks/useAlertThresholds";

interface BusinessSettings extends Partial<AlertThresholds> {
  queueReminderIntervalMinutes?: number;
  dailyConversationGoal?: number | null;
}

const MAX_ALERT_MINUTES = 240;
const ALERT_FIELDS: { key: keyof AlertThresholds; label: string }[] = [
  { key: "noReplyWarningMinutes", label: "Sem resposta: amarelo após (min)" },
  { key: "noReplyDangerMinutes", label: "Sem resposta: vermelho após (min)" },
  { key: "queueWarningMinutes", label: "Na fila: amarelo após (min)" },
  { key: "queueDangerMinutes", label: "Na fila: vermelho após (min)" },
];

const MIN_MINUTES = 1;
const MAX_MINUTES = 60; // matches the backend's zod schema
const MAX_GOAL = 500;

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
  // Empty = no goal: "Meu dia" in Atendimento shows no bar.
  const [goal, setGoal] = useState("");
  const savedGoal = data?.dailyConversationGoal ? String(data.dailyConversationGoal) : "";
  const savedAlerts: AlertThresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...data };
  const [alerts, setAlerts] = useState<AlertThresholds>(DEFAULT_ALERT_THRESHOLDS);
  useEffect(() => {
    if (data?.queueReminderIntervalMinutes) setMinutes(data.queueReminderIntervalMinutes);
    setGoal(data?.dailyConversationGoal ? String(data.dailyConversationGoal) : "");
    setAlerts({ ...DEFAULT_ALERT_THRESHOLDS, ...data });
  }, [data]);
  const goalValid = goal === "" || (Number.isInteger(Number(goal)) && Number(goal) >= 1 && Number(goal) <= MAX_GOAL);
  const alertsValid =
    Object.values(alerts).every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_ALERT_MINUTES) &&
    alerts.noReplyDangerMinutes > alerts.noReplyWarningMinutes &&
    alerts.queueDangerMinutes > alerts.queueWarningMinutes;
  const alertsDirty = ALERT_FIELDS.some(({ key }) => alerts[key] !== savedAlerts[key]);
  const canSave = minutes >= MIN_MINUTES && minutes <= MAX_MINUTES && goalValid && alertsValid;

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/settings/queue", { queueReminderIntervalMinutes: minutes, dailyConversationGoal: goal === "" ? null : Number(goal), ...alerts }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      queryClient.invalidateQueries({ queryKey: ["my-day"] });
      toast.success("Configurações da fila salvas.");
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

      <div className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Alertas de tempo</h2>
        <p className="mt-1 text-sm text-muted">
          O cartão da conversa fica amarelo e depois vermelho quando o cliente espera demais por uma resposta (Meus) ou para ser aceito (Fila).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ALERT_FIELDS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-1 block text-sm font-medium">{label}</span>
              <input
                type="number"
                min={1}
                max={MAX_ALERT_MINUTES}
                step={1}
                value={alerts[key]}
                disabled={!canEditar}
                onChange={(e) => setAlerts((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
          ))}
        </div>
        {!alertsValid && <p className="mt-2 text-xs text-danger">O vermelho precisa vir depois do amarelo (entre 1 e {MAX_ALERT_MINUTES} minutos).</p>}
      </div>

      <div className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Meta diária</h2>
        <p className="mt-1 text-sm text-muted">
          Quantos atendimentos cada atendente deve encerrar por dia. Aparece como uma barra de progresso no &quot;Meu dia&quot;, em Atendimento. Deixe em branco
          para não mostrar meta.
        </p>
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-sm font-medium">Atendimentos encerrados por dia</span>
          <input
            type="number"
            min={1}
            max={MAX_GOAL}
            step={1}
            value={goal}
            placeholder="Sem meta"
            disabled={!canEditar}
            onChange={(e) => setGoal(e.target.value)}
            className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
      </div>

      {canEditar && (
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !canSave}
          className="focus-ring rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
        >
          Salvar configuração
        </button>
      )}
      {canEditar && data && (
        <UnsavedChangesBar
          dirty={(data.queueReminderIntervalMinutes !== undefined && minutes !== data.queueReminderIntervalMinutes) || goal !== savedGoal || alertsDirty}
          saving={saveMutation.isPending}
          canSave={canSave}
          onSave={() => saveMutation.mutate()}
          onDiscard={() => {
            setMinutes(data.queueReminderIntervalMinutes ?? 1);
            setGoal(savedGoal);
            setAlerts(savedAlerts);
          }}
        />
      )}
    </div>
  );
}
