import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, X } from "lucide-react";
import { toast } from "sonner";
import type { ContactImportResultDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";

const MAX_FILE_BYTES = 1_500_000; // matches the API's limit on the CSV text
const SHOWN_ERRORS = 20;

/** Imports a CSV (Nome; Telefone; Etiquetas) into one WhatsApp connection. */
export function ImportContactsModal({ connections, onClose }: { connections: { id: string; name: string }[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [connectionId, setConnectionId] = useState(connections.length === 1 ? connections[0].id : "");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ContactImportResultDTO | null>(null);

  const importCsv = useMutation({
    mutationFn: async () => (await api.post<ContactImportResultDTO>("/contacts/import", { whatsappConnectionId: connectionId, csv: await file!.text() })).data,
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  function pick(picked: File | undefined) {
    setResult(null);
    if (picked && picked.size > MAX_FILE_BYTES) {
      toast.error("Arquivo grande demais — divida em planilhas de até 5.000 contatos.");
      return;
    }
    setFile(picked ?? null);
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel max-w-md" role="dialog" aria-modal="true" aria-labelledby="import-contacts-title" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="import-contacts-title" className="text-base font-semibold">
            Importar contatos
          </h2>
          <button type="button" onClick={onClose} className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="rounded-card bg-surface-alt px-3 py-2.5 text-xs leading-relaxed text-muted">
            <p>
              Planilha CSV com cabeçalho e as colunas <b className="text-[var(--color-text)]">Nome</b>, <b className="text-[var(--color-text)]">Telefone</b> e{" "}
              <b className="text-[var(--color-text)]">Etiquetas</b> (opcional, várias separadas por vírgula). Separador ponto e vírgula ou vírgula.
            </p>
            <p className="mt-1">Telefone com DDD; sem o DDI na frente, o DDI padrão é adicionado, e o 9 a mais de um celular é corrigido (veja Configurações › Números de telefone). Um telefone que já existe na conexão é atualizado, não duplicado.</p>
            <p className="mt-1 font-mono text-[11px]">Nome;Telefone;Etiquetas{"\n"}Ana Souza;11 98765-4321;VIP, Atacado</p>
          </div>

          <label className="block">
            <span className="mb-1 block font-medium">Conexão</span>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2"
            >
              <option value="" disabled>
                Selecione...
              </option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="focus-within:ring-primary/40 flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-dashed border-border px-4 py-6 text-center hover:bg-surface-alt focus-within:ring-2">
            <FileUp className="h-5 w-5 text-muted" />
            <span className="font-medium">{file ? file.name : "Escolher arquivo .csv"}</span>
            <span className="text-xs text-muted">Até 5.000 contatos por arquivo</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>

          {result && (
            <div className="space-y-2 rounded-card border border-border p-3" role="status">
              <p>
                <b>{result.created}</b> criados · <b>{result.updated}</b> atualizados
                {result.errors.length > 0 && (
                  <>
                    {" "}
                    · <b className="text-danger">{result.errors.length}</b> com problema
                  </>
                )}
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
                  {result.errors.slice(0, SHOWN_ERRORS).map((e) => (
                    <li key={e.line}>
                      Linha {e.line}: {e.reason}
                    </li>
                  ))}
                  {result.errors.length > SHOWN_ERRORS && <li>… e mais {result.errors.length - SHOWN_ERRORS}</li>}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm hover:bg-surface-alt">
            {result ? "Fechar" : "Cancelar"}
          </button>
          <button
            type="button"
            disabled={!file || !connectionId || importCsv.isPending}
            onClick={() => importCsv.mutate()}
            className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-50"
          >
            {importCsv.isPending ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>
    </div>
  );
}
