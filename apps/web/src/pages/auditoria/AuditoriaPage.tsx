import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { AuditLogDTO, PaginatedResult } from "@whatsatendende/types";
import { api } from "../../lib/api";

// Every distinct `entity` string ever passed to writeAudit() across the API
// — see e.g. auth.service.ts, users.routes.ts, conversations.routes.ts. The
// backend filter is an exact match, so this doubles as the filter's option
// list; a new entity added on the backend just won't have a dedicated
// filter option here until this list is updated (it still shows up fine
// under "Todas").
const ENTITY_OPTIONS = ["User", "Conversation", "Contact", "Message", "WhatsAppConnection", "SystemSetting", "RolePermission"];

function formatAction(action: string): string {
  return action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, " ");
}

async function fetchAuditLog(cursor: string | undefined, entity: string) {
  const res = await api.get<PaginatedResult<AuditLogDTO>>("/audit-logs", {
    params: { cursor, limit: 50, entity: entity || undefined },
  });
  return res.data;
}

export default function AuditoriaPage() {
  const [entity, setEntity] = useState("");
  const [logs, setLogs] = useState<AuditLogDTO[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useQuery({
    queryKey: ["audit-log", entity],
    queryFn: () => fetchAuditLog(undefined, entity),
  });

  // A filter change restarts the list from page one rather than appending —
  // same reset-on-filter-change shape as everywhere else filters exist in
  // this app (Relatórios, Gestão).
  useEffect(() => {
    if (!query.data) return;
    setLogs(query.data.items);
    setCursor(query.data.nextCursor ?? undefined);
  }, [query.data]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuditLog(cursor, entity);
      setLogs((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor ?? undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Histórico de ações realizadas no sistema — logins, alterações de conversas, usuários e configurações.</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Entidade</span>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            className="focus-ring rounded-card border border-border bg-transparent px-3 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {ENTITY_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Data/hora</th>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!query.isLoading && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-border align-top hover:bg-surface-alt">
                <td className="whitespace-nowrap px-4 py-3 text-muted">{format(new Date(log.createdAt), "dd/MM/yyyy HH:mm:ss")}</td>
                <td className="px-4 py-3">{log.userDisplayName}</td>
                <td className="px-4 py-3">{formatAction(log.action)}</td>
                <td className="px-4 py-3 text-muted">{log.entity}</td>
                <td className="px-4 py-3 text-muted">{log.ipAddress ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="focus-ring rounded-card border border-border px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-60"
          >
            {loadingMore ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
