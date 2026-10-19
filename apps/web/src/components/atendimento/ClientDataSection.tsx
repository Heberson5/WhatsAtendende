import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import clsx from "clsx";
import { AlertTriangle, Copy, Eye, Users } from "lucide-react";
import { PERMISSION, type ClientContractDTO, type ClientDataDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { clientDataKey, useClientData } from "../../hooks/useClientData";

export const CLIENT_DATA_UNAVAILABLE = "Dados do cliente indisponíveis no momento";

function copy(value: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success("Copiado."))
    .catch(() => toast.error("Não foi possível copiar."));
}

function CopyButton({ value }: { value: string }) {
  return (
    <button type="button" onClick={() => copy(value)} className="focus-ring shrink-0 rounded p-0.5 text-muted hover:text-[var(--color-text)]" aria-label="Copiar" title="Copiar">
      <Copy className="h-3 w-3" />
    </button>
  );
}

function ContractCard({ contract, children }: { contract: ClientContractDTO; children?: React.ReactNode }) {
  const holderFirst = [...contract.beneficiaries].sort((a, b) => Number(b.holder) - Number(a.holder));
  return (
    <div className={clsx("overflow-hidden rounded-lg border text-xs", contract.suspended ? "border-danger" : "border-border")}>
      {contract.suspended && (
        <p className="flex items-center gap-1 bg-danger px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          <AlertTriangle className="h-3.5 w-3.5" /> Suspenso por inadimplência
        </p>
      )}
      <div className="space-y-2 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 font-semibold">
            Contrato {contract.number} <CopyButton value={contract.number} />
          </span>
          {contract.status && <span className="shrink-0 text-muted">{contract.status}</span>}
        </div>
        {contract.plan && <p className="text-muted">{contract.plan}</p>}
        {contract.overdueCount > 0 && (
          <p className="font-medium text-danger">
            {contract.overdueCount} parcela{contract.overdueCount > 1 ? "s" : ""} vencida{contract.overdueCount > 1 ? "s" : ""}
            {contract.suspensionThreshold && ` · suspende com ${contract.suspensionThreshold}`}
          </p>
        )}
        {holderFirst.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 font-medium">
              <Users className="h-3 w-3" /> {holderFirst.length} beneficiário{holderFirst.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-0.5">
              {holderFirst.map((b, i) => (
                <li key={`${b.name}-${i}`} className="flex flex-wrap items-center gap-x-1">
                  <span className={clsx(b.holder && "font-semibold")}>{b.name}</span>
                  <span className="text-muted">
                    · {b.relation ?? "—"}
                    {b.age !== null && ` · ${b.age} anos`}
                  </span>
                  {b.aggregated && <span className="rounded bg-surface-alt px-1 text-[10px] font-semibold">agregado</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * "Dados do cliente" from the active data source. Never partial: if the
 * source is off, failing or past its limit, the attendant only sees that the
 * data is unavailable (managers also see why).
 */
export function ClientDataSection({
  conversationId,
  readOnly,
  renderContractExtra,
}: {
  conversationId: string;
  readOnly?: boolean;
  /** Boleto sending hooks in here, per contract. */
  renderContractExtra?: (contract: ClientContractDTO, data: ClientDataDTO) => React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const canReveal = useAuthStore((s) => Boolean(s.permissions?.[PERMISSION.CLIENTE_DADOS_SENSIVEIS_VER]));
  const { data } = useClientData(conversationId);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const selectMutation = useMutation({
    mutationFn: async (clientKey: string) => (await api.put<ClientDataDTO>(`/conversations/${conversationId}/client-data/client`, { clientKey })).data,
    onSuccess: (result) => queryClient.setQueryData(clientDataKey(conversationId), result),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });
  const revealMutation = useMutation({
    mutationFn: async (column: string) => (await api.post<{ column: string; value: string }>(`/conversations/${conversationId}/client-data/reveal`, { column })).data,
    onSuccess: ({ column, value }) => setRevealed((prev) => ({ ...prev, [column]: value })),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  if (!data || data.status === "NO_SOURCE") return null;
  if (data.status === "UNAVAILABLE") {
    return (
      <div className="rounded-lg border border-warning bg-warning-soft px-3 py-2 text-xs">
        <p className="font-semibold">{CLIENT_DATA_UNAVAILABLE}</p>
        {data.reason && <p className="mt-0.5 text-muted">{data.reason}</p>}
      </div>
    );
  }
  if (data.status === "NOT_FOUND") return <p className="text-xs text-muted">Este telefone não está na fonte de dados.</p>;

  const updated = data.dataUpdatedAt && <p className="text-[11px] text-muted">Dados de {format(new Date(data.dataUpdatedAt), "dd/MM HH:mm")}</p>;

  if (!data.client) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Este telefone é de mais de um cliente. Qual é este atendimento?</p>
        {data.clients.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={readOnly || selectMutation.isPending}
            onClick={() => selectMutation.mutate(c.key)}
            className="focus-ring flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-surface-alt disabled:opacity-60"
          >
            <span className="truncate font-medium">{c.name}</span>
            {c.cpfPartial && <span className="shrink-0 tabular-nums text-muted">{c.cpfPartial}</span>}
          </button>
        ))}
        {updated}
      </div>
    );
  }

  const fields = data.client.fields.filter((f) => f.value);
  const visibleFields = showAll ? fields : fields.slice(0, 8);
  return (
    <div className="space-y-2.5">
      {data.clients.length > 1 && !readOnly && (
        <select
          value={data.selectedClientKey ?? ""}
          onChange={(e) => selectMutation.mutate(e.target.value)}
          className="focus-ring w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs"
          aria-label="Cliente deste atendimento"
        >
          {data.clients.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name} {c.cpfPartial ?? ""}
            </option>
          ))}
        </select>
      )}
      {data.client.contracts.map((contract) => (
        <ContractCard key={contract.number} contract={contract}>
          {renderContractExtra?.(contract, data)}
        </ContractCard>
      ))}
      <div className="space-y-0.5">
        {visibleFields.map((field) => {
          const value = revealed[field.column] ?? field.value;
          return (
            <div key={field.column} className="flex items-start justify-between gap-2 text-xs">
              <span className="shrink-0 text-muted">{field.column}</span>
              <span className="flex min-w-0 items-center gap-1 text-right">
                <span className="break-words">{value}</span>
                {field.sensitive && !revealed[field.column] ? (
                  canReveal && (
                    <button
                      type="button"
                      onClick={() => revealMutation.mutate(field.column)}
                      className="focus-ring shrink-0 rounded p-0.5 text-muted hover:text-[var(--color-text)]"
                      aria-label={`Mostrar ${field.column}`}
                      title="Mostrar (fica registrado na auditoria)"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  )
                ) : (
                  <CopyButton value={value} />
                )}
              </span>
            </div>
          );
        })}
        {fields.length > 8 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="focus-ring text-[11px] font-medium text-primary hover:underline">
            {showAll ? "Mostrar menos" : `Mostrar todas (${fields.length})`}
          </button>
        )}
      </div>
      {updated}
    </div>
  );
}
