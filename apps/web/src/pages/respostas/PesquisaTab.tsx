import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PERMISSION,
  type SatisfactionSurveySettingsDTO,
} from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { UnsavedChangesBar } from "../../components/common/UnsavedChangesBar";
import { renderWhatsAppFormatting } from "../../lib/whatsappFormatting";
import {
  ConnectionScopePicker,
  toConnectionScopeValue,
  type ConnectionScopeValue,
} from "./ConnectionScopePicker";

const MIN_WINDOW_HOURS = 1;
const MAX_WINDOW_HOURS = 72; // matches the backend's zod schema

interface FormValues {
  enabled: boolean;
  connectionScope: ConnectionScopeValue;
  question: string;
  thanks: string;
  answerWindowHours: number;
}

function toForm(dto: SatisfactionSurveySettingsDTO): FormValues {
  return {
    enabled: dto.enabled,
    connectionScope: toConnectionScopeValue(dto.connectionScope, false),
    question: dto.question,
    thanks: dto.thanks,
    answerWindowHours: dto.answerWindowHours,
  };
}

/** Pesquisa de satisfação sent when a conversation is closed — off until someone switches it on here. */
export function PesquisaTab() {
  const queryClient = useQueryClient();
  const canEditar = useAuthStore(
    (s) => s.permissions?.[PERMISSION.RESPOSTAS_PESQUISA_EDITAR],
  );
  const { data } = useQuery({
    queryKey: ["satisfaction-survey-settings"],
    queryFn: async () =>
      (
        await api.get<SatisfactionSurveySettingsDTO>(
          "/satisfaction-survey/settings",
        )
      ).data,
  });

  const [values, setValues] = useState<FormValues | null>(null);
  useEffect(() => {
    if (data) setValues(toForm(data));
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: FormValues) =>
      (
        await api.put<SatisfactionSurveySettingsDTO>(
          "/satisfaction-survey/settings",
          next,
        )
      ).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(["satisfaction-survey-settings"], saved);
      toast.success(
        saved.enabled
          ? "Pesquisa de satisfação ligada."
          : "Pesquisa de satisfação salva (desligada).",
      );
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  if (!data || !values) return null;
  const saved = toForm(data);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const scopeMissing =
    !values.connectionScope.allConnections &&
    values.connectionScope.connectionIds.length === 0;
  const valid =
    values.question.trim() !== "" &&
    values.thanks.trim() !== "" &&
    values.answerWindowHours >= MIN_WINDOW_HOURS &&
    values.answerWindowHours <= MAX_WINDOW_HOURS &&
    !(values.enabled && scopeMissing);
  const set = (patch: Partial<FormValues>) =>
    setValues((v) => (v ? { ...v, ...patch } : v));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl space-y-5 py-2">
        <p className="text-sm text-muted">
          Ao encerrar uma conversa atendida, o cliente recebe a pergunta abaixo
          e responde com uma nota de 1 a 5. A nota fica registrada na própria
          conversa e aparece no Dashboard e em Relatórios › Por atendente. Na
          API Oficial, só é enviada se o cliente escreveu nas últimas 24 horas.
        </p>

        <fieldset
          disabled={!canEditar}
          className="space-y-4 rounded-card border border-border bg-surface p-5 disabled:opacity-70"
        >
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">
                Enviar pesquisa ao encerrar
              </span>
              <span className="block text-xs text-muted">
                {values.enabled
                  ? "Ligada — será enviada nas conexões escolhidas."
                  : "Desligada — nada é enviado aos clientes."}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={values.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
              className="h-5 w-5 shrink-0 accent-primary"
            />
          </label>

          <ConnectionScopePicker
            value={values.connectionScope}
            onChange={(connectionScope) => set({ connectionScope })}
            hint={
              values.enabled && scopeMissing
                ? "Escolha pelo menos uma conexão para ligar a pesquisa."
                : "A pesquisa só é enviada em conversas dessas conexões."
            }
          />

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Pergunta</span>
            <textarea
              rows={3}
              value={values.question}
              onChange={(e) => set({ question: e.target.value })}
              maxLength={1024}
              className="focus-ring w-full resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Agradecimento
            </span>
            <input
              value={values.thanks}
              onChange={(e) => set({ thanks: e.target.value })}
              maxLength={1024}
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted">
              Enviado quando o cliente responde com uma nota válida.
            </span>
          </label>

          <label className="block max-w-xs">
            <span className="mb-1 block text-sm font-medium">
              Aceitar resposta por até (horas)
            </span>
            <input
              type="number"
              min={MIN_WINDOW_HOURS}
              max={MAX_WINDOW_HOURS}
              value={values.answerWindowHours}
              onChange={(e) =>
                set({ answerWindowHours: Number(e.target.value) })
              }
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted">
              Depois disso, ou se o cliente escrever outra coisa, a mensagem
              abre uma conversa normal.
            </span>
          </label>

          <div>
            <p className="mb-1 text-xs font-medium text-muted">
              Prévia de como o cliente vai receber:
            </p>
            <div className="max-w-sm whitespace-pre-wrap break-words rounded-card bg-primary px-3 py-2 text-sm text-primary-fg shadow-soft">
              {renderWhatsAppFormatting(values.question || "...")}
            </div>
          </div>
        </fieldset>

        {canEditar && (
          <UnsavedChangesBar
            dirty={dirty}
            saving={save.isPending}
            canSave={valid}
            onSave={() => save.mutate(values)}
            onDiscard={() => setValues(saved)}
          />
        )}
      </div>
    </div>
  );
}
