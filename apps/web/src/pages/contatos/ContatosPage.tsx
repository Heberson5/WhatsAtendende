import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, MessageSquarePlus, Search, Tags, Upload } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { PERMISSION, type ContactListItemDTO, type ContactSortField, type ConversationListItemDTO, type TagDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { ContactDrawer } from "./ContactDrawer";
import { ImportContactsModal } from "./ImportContactsModal";
import { TagsManagerDrawer } from "./TagsManagerDrawer";
import { TagChip, formatContactPhone } from "./contactFormat";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

interface ConnectionOption {
  id: string;
  name: string;
}

type SortDir = "asc" | "desc";

/** Each column orders the way its data reads: names A–Z first, numbers and dates from the most recent / largest first. */
const SORT_COLUMNS: { field: ContactSortField; label: string; firstDir: SortDir; align?: "right"; hint: Record<SortDir, string> }[] = [
  { field: "name", label: "Nome", firstDir: "asc", hint: { asc: "A a Z", desc: "Z a A" } },
  { field: "phone", label: "Telefone", firstDir: "asc", hint: { asc: "menor para maior", desc: "maior para menor" } },
  { field: "connection", label: "Conexão", firstDir: "asc", hint: { asc: "A a Z", desc: "Z a A" } },
];
const SORT_COLUMNS_AFTER_TAGS: typeof SORT_COLUMNS = [
  { field: "conversations", label: "Conversas", firstDir: "desc", align: "right", hint: { asc: "menos para mais", desc: "mais para menos" } },
  { field: "firstConversationAt", label: "Primeiro contato", firstDir: "desc", hint: { asc: "mais antigo primeiro", desc: "mais recente primeiro" } },
  { field: "lastInteractionAt", label: "Última interação", firstDir: "desc", hint: { asc: "mais antiga primeiro", desc: "mais recente primeiro" } },
];

function SortHeader({ column, sort, onSort }: { column: (typeof SORT_COLUMNS)[number]; sort: { field: ContactSortField; dir: SortDir }; onSort: (field: ContactSortField, dir: SortDir) => void }) {
  const active = sort.field === column.field;
  const nextDir: SortDir = active ? (sort.dir === "asc" ? "desc" : "asc") : column.firstDir;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={clsx("px-4 py-3", column.align === "right" && "text-right")} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(column.field, nextDir)}
        className={clsx("focus-ring inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-[var(--color-text)]", active && "text-[var(--color-text)]")}
        title={`Ordenar: ${column.hint[nextDir]}`}
      >
        {column.label}
        <Icon className={clsx("h-3.5 w-3.5", !active && "opacity-40")} aria-hidden />
      </button>
    </th>
  );
}

/** Tela de Contatos: busca, etiquetas, histórico de conversas, importação e exportação em CSV. */
export default function ContatosPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canImportExport = permissions?.[PERMISSION.CONTATOS_IMPORTAR_EXPORTAR];
  const canManageTags = permissions?.[PERMISSION.CONTATOS_ETIQUETAS_GERENCIAR];
  const canAttend = permissions?.[PERMISSION.ATENDIMENTO_ACESSAR];
  const isAgent = useAuthStore((s) => s.user?.role === "AGENT");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<{ field: ContactSortField; dir: SortDir }>({ field: "lastInteractionAt", dir: "desc" });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [page, setPage] = useState(1);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = { search: search || undefined, tagId: tagId || undefined, connectionId: connectionId || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", filters, page, sort],
    queryFn: async () =>
      (await api.get<{ items: ContactListItemDTO[]; total: number }>("/contacts", { params: { ...filters, page, pageSize: PAGE_SIZE, sort: sort.field, dir: sort.dir } })).data,
    placeholderData: (previous) => previous,
  });
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: async () => (await api.get<TagDTO[]>("/tags")).data });
  const { data: connections } = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: async () => (await api.get<ConnectionOption[]>("/whatsapp/connections")).data,
    // An attendant sees only their own connection's contacts — no filter to show.
    enabled: !isAgent,
  });

  // Starts (or reopens, if it's already theirs) a conversation and goes straight to it in Atendimento.
  const startConversation = useMutation({
    mutationFn: async (contact: ContactListItemDTO) =>
      (
        await api.post<ConversationListItemDTO>("/conversations/start", {
          phone: contact.phone,
          name: contact.name ?? undefined,
          connectionId: isAgent ? undefined : (contact.whatsappConnectionId ?? undefined),
        })
      ).data,
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      navigate(`/atendimento?open=${conversation.id}`);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api.get<Blob>("/contacts/export", { params: filters, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "contatos.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Todos os clientes que já conversaram com a empresa, com etiquetas e histórico de atendimentos.</p>
        <div className="flex flex-wrap gap-2">
          {canManageTags && (
            <button
              type="button"
              onClick={() => setTagsOpen(true)}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-alt"
            >
              <Tags className="h-4 w-4" /> Etiquetas
            </button>
          )}
          {canImportExport && (
            <>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="focus-ring flex items-center gap-1.5 rounded-card border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-alt"
              >
                <Upload className="h-4 w-4" /> Importar CSV
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={exporting}
                className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-3 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-60"
              >
                <Download className="h-4 w-4" /> {exporting ? "Exportando..." : "Exportar CSV"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-sm focus-within:border-primary/50 sm:flex-none">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar nome ou telefone"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        <select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por etiqueta"
          className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="">Todas as etiquetas</option>
          {tags?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {(connections?.length ?? 0) > 1 && (
          <select
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrar por conexão"
            className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Todas as conexões</option>
            {connections?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <span className="ms-auto text-xs tabular-nums text-muted">{total.toLocaleString("pt-BR")} contatos</span>
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {SORT_COLUMNS.map((column) => (
                <SortHeader key={column.field} column={column} sort={sort} onSort={(field, dir) => (setSort({ field, dir }), setPage(1))} />
              ))}
              <th className="px-4 py-3">Etiquetas</th>
              {SORT_COLUMNS_AFTER_TAGS.map((column) => (
                <SortHeader key={column.field} column={column} sort={sort} onSort={(field, dir) => (setSort({ field, dir }), setPage(1))} />
              ))}
              {canAttend && <th className="px-4 py-3"><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={canAttend ? 8 : 7} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={canAttend ? 8 : 7} className="px-4 py-8 text-center text-muted">
                  Nenhum contato encontrado.
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} onClick={() => setOpenContactId(c.id)} className="cursor-pointer border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3 font-medium">
                  <button type="button" className="focus-ring rounded text-left" onClick={() => setOpenContactId(c.id)}>
                    {c.name || <span className="text-muted">Sem nome</span>}
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{formatContactPhone(c)}</td>
                <td className="px-4 py-3 text-muted">{c.connectionName ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{c.conversationCount}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{new Date(c.firstConversationAt).toLocaleDateString("pt-BR")}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{new Date(c.lastInteractionAt).toLocaleDateString("pt-BR")}</td>
                {canAttend && (
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {c.channel === "WHATSAPP" && c.phone && (
                      <button
                        type="button"
                        onClick={() => startConversation.mutate(c)}
                        disabled={startConversation.isPending}
                        className="focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-card border border-primary/30 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
                        aria-label={`Iniciar conversa com ${c.name || formatContactPhone(c)}`}
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                        {startConversation.isPending && startConversation.variables?.id === c.id ? "Abrindo..." : "Iniciar conversa"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1}
            className="focus-ring rounded-card border border-border p-1.5 disabled:opacity-40"
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums text-muted">
            {page} de {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page === pageCount}
            className="focus-ring rounded-card border border-border p-1.5 disabled:opacity-40"
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {openContactId && <ContactDrawer contactId={openContactId} tags={tags ?? []} onClose={() => setOpenContactId(null)} />}
      {importOpen && <ImportContactsModal connections={connections ?? []} onClose={() => setImportOpen(false)} />}
      {tagsOpen && <TagsManagerDrawer onClose={() => setTagsOpen(false)} />}
    </div>
  );
}
