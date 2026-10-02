import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flag,
  List,
  MessageSquareText,
  Plug,
  Save,
  Trash2,
  UserCheck2,
} from "lucide-react";
import type { FlowDetailDTO, FlowEdgeDTO, FlowNodeData, FlowNodeDTO, FlowNodeType } from "@whatsatendende/types";
import { PERMISSION } from "@whatsatendende/types";
import { useAuthStore } from "../../store/auth-store";
import { api, getApiErrorMessage } from "../../lib/api";

interface OfficialConnectionOption {
  id: string;
  name: string;
  connectionMode: "QRCODE" | "OFFICIAL_API";
}

interface AgentOption {
  id: string;
  displayName: string;
  presence: "ONLINE" | "AWAY" | "OFFLINE";
}

const NODE_WIDTH = 220;
const PRESENCE_DOT: Record<string, string> = { ONLINE: "bg-green-500", AWAY: "bg-yellow-500", OFFLINE: "bg-gray-400" };

const NODE_META: Record<FlowNodeType, { label: string; icon: typeof MessageSquareText; color: string }> = {
  START: { label: "Início", icon: Flag, color: "#0097B4" },
  TEXT_MESSAGE: { label: "Mensagem de texto", icon: MessageSquareText, color: "#0097B4" },
  MENU: { label: "Menu de opções", icon: List, color: "#7C3AED" },
  TRANSFER_TO_AGENT: { label: "Transferir para atendente", icon: UserCheck2, color: "#059669" },
  END: { label: "Fim", icon: Flag, color: "#DC2626" },
};

const PALETTE: { type: FlowNodeType; defaultData: FlowNodeData }[] = [
  { type: "TEXT_MESSAGE", defaultData: { text: "" } },
  { type: "MENU", defaultData: { options: [] } },
  { type: "TRANSFER_TO_AGENT", defaultData: { assignedAgentIds: [] } },
  { type: "END", defaultData: {} },
];

interface EditorNode extends FlowNodeDTO {
  isNew?: boolean;
}

function nodePreview(node: EditorNode): string {
  if (node.type === "TEXT_MESSAGE") {
    const text = (node.data as { text?: string }).text;
    return text ? text.slice(0, 60) : "Sem texto definido";
  }
  if (node.type === "MENU") {
    const options = (node.data as { options?: { id: string; label: string }[] }).options ?? [];
    return options.length ? `${options.length} opção(ões)` : "Sem opções";
  }
  if (node.type === "TRANSFER_TO_AGENT") {
    const ids = (node.data as { assignedAgentIds?: string[] }).assignedAgentIds ?? [];
    return ids.length ? `${ids.length} atendente(s) designado(s)` : "Qualquer atendente disponível";
  }
  return "";
}

export default function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canEditar = Boolean(permissions?.[PERMISSION.FLUXO_EDITAR]);

  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<FlowEdgeDTO[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ sourceNodeId: string; sourceHandle: string | null } | null>(null);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const scrolledIntoViewRef = useRef<Set<string>>(new Set());

  const { data: flow, isLoading } = useQuery({
    queryKey: ["flow", id],
    queryFn: async () => (await api.get<FlowDetailDTO>(`/flows/${id}`)).data,
    enabled: Boolean(id),
  });

  // Toggling Ativo/Inativo or editing Conexões (metaMutation) both
  // invalidate this same query, which would otherwise wipe out whatever
  // unsaved canvas edits the user has made — so this only (re)seeds local
  // state the first time a given flow id loads, never on a later refetch
  // of metadata that isn't the node graph itself.
  const loadedFlowIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (flow && loadedFlowIdRef.current !== flow.id) {
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setDirty(false);
      loadedFlowIdRef.current = flow.id;
    }
  }, [flow]);

  const { data: connections } = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: async () => (await api.get<OfficialConnectionOption[]>("/whatsapp/connections")).data,
  });
  const officialConnections = connections?.filter((c) => c.connectionMode === "OFFICIAL_API") ?? [];

  const { data: agents } = useQuery({
    queryKey: ["agents-transfer-targets-all"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents/transfer-targets", { params: { excludeSelf: false } })).data,
  });

  const metaMutation = useMutation({
    mutationFn: (patch: { active?: boolean; connectionIds?: string[] }) => api.patch(`/flows/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow", id] });
      queryClient.invalidateQueries({ queryKey: ["flows"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<FlowDetailDTO>(`/flows/${id}/graph`, {
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, positionX: n.positionX, positionY: n.positionY, data: n.data })),
        edges: edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle })),
      }),
    onSuccess: (res) => {
      setNodes(res.data.nodes);
      setEdges(res.data.edges);
      setDirty(false);
      setSelectedNodeId(null);
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Fluxo salvo.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  function updateNodeData(nodeId: string, data: FlowNodeData) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data } : n)));
    setDirty(true);
  }

  function addNode(type: FlowNodeType, defaultData: FlowNodeData) {
    const newId = `new-${crypto.randomUUID()}`;
    // Grid-ish fan-out (3 per row) so nodes added back-to-back don't land
    // stacked on top of each other — spacing wide enough for NODE_WIDTH
    // plus a taller MENU/TRANSFER_TO_AGENT card.
    const index = nodes.length;
    const column = index % 3;
    const row = Math.floor(index / 3);
    setNodes((ns) => [...ns, { id: newId, type, positionX: 360 + column * 280, positionY: 80 + row * 180, data: defaultData, isNew: true }]);
    setSelectedNodeId(newId);
    setDirty(true);
  }

  function deleteNode(nodeId: string) {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setDirty(true);
  }

  function startConnection(sourceNodeId: string, sourceHandle: string | null) {
    setPendingConnection((p) => (p?.sourceNodeId === sourceNodeId && p.sourceHandle === sourceHandle ? null : { sourceNodeId, sourceHandle }));
  }

  function completeConnection(targetNodeId: string) {
    if (!pendingConnection || pendingConnection.sourceNodeId === targetNodeId) {
      setPendingConnection(null);
      return;
    }
    setEdges((es) => {
      const withoutDuplicate = es.filter((e) => !(e.sourceNodeId === pendingConnection.sourceNodeId && e.sourceHandle === pendingConnection.sourceHandle));
      return [
        ...withoutDuplicate,
        { id: `new-edge-${crypto.randomUUID()}`, sourceNodeId: pendingConnection.sourceNodeId, targetNodeId, sourceHandle: pendingConnection.sourceHandle },
      ];
    });
    setPendingConnection(null);
    setDirty(true);
  }

  function handleNodePointerDown(e: React.PointerEvent, node: EditorNode) {
    if ((e.target as HTMLElement).closest("[data-connector]")) return;
    setSelectedNodeId(node.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { nodeId: node.id, offsetX: e.clientX - node.positionX, offsetY: e.clientY - node.positionY };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { nodeId, offsetX, offsetY } = dragRef.current;
    const x = Math.max(0, e.clientX - offsetX);
    const y = Math.max(0, e.clientY - offsetY);
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, positionX: x, positionY: y } : n)));
  }

  function handlePointerUp() {
    if (dragRef.current) setDirty(true);
    dragRef.current = null;
  }

  // Connector anchor points for each node — drawn as small dots clicked to
  // start/finish an edge. MENU fans out one per option; everything else
  // (except END) has a single output.
  const nodeOutputs = useMemo(() => {
    const map = new Map<string, { handle: string | null; label?: string }[]>();
    for (const node of nodes) {
      if (node.type === "END") {
        map.set(node.id, []);
      } else if (node.type === "MENU") {
        const options = (node.data as { options?: { id: string; label: string }[] }).options ?? [];
        map.set(node.id, options.map((o) => ({ handle: o.id, label: o.label })));
      } else {
        map.set(node.id, [{ handle: null }]);
      }
    }
    return map;
  }, [nodes]);

  if (isLoading || !flow) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Carregando fluxo...</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => navigate("/fluxo")} className="focus-ring rounded-card p-1.5 text-muted hover:bg-surface-alt" aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{flow.name}</h1>
            {flow.description && <p className="truncate text-xs text-muted">{flow.description}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setConnectionsOpen((o) => !o)}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
            >
              <Plug className="h-3.5 w-3.5" /> Conexões ({flow.connectionIds.length})
            </button>
            {connectionsOpen && (
              <div className="absolute right-0 top-10 z-20 w-64 rounded-card border border-border bg-surface p-2 shadow-lg">
                <p className="mb-1.5 px-1 text-xs font-medium text-muted">Conexões WhatsApp Oficial</p>
                {officialConnections.length === 0 && <p className="px-1 text-xs text-muted">Nenhuma conexão WhatsApp Oficial cadastrada.</p>}
                <div className="max-h-48 overflow-y-auto">
                  {officialConnections.map((c) => {
                    const checked = flow.connectionIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 rounded-card px-2 py-1.5 text-sm hover:bg-surface-alt">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canEditar || metaMutation.isPending}
                          onChange={() => {
                            const next = checked ? flow.connectionIds.filter((cid) => cid !== c.id) : [...flow.connectionIds, c.id];
                            metaMutation.mutate({ connectionIds: next });
                          }}
                          className="h-4 w-4 accent-primary"
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => canEditar && metaMutation.mutate({ active: !flow.active })}
            disabled={!canEditar || metaMutation.isPending}
            role="switch"
            aria-checked={flow.active}
            title={flow.active ? "Desativar fluxo" : "Ativar fluxo"}
            className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
              flow.active ? "border-green-500/40 bg-green-500/15 text-green-600" : "border-border text-muted"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${flow.active ? "bg-green-500" : "bg-muted"}`} />
            {flow.active ? "Ativo" : "Inativo"}
          </button>

          {canEditar && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !dirty}
              className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-4 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          )}
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Node palette — collapsible, see PROMPT: "A barra lateral dos nós, precisa ter a função de recolher". */}
        <div className={`shrink-0 overflow-hidden border-r border-border bg-surface transition-all ${paletteCollapsed ? "w-0" : "w-56"}`}>
          <div className="w-56 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Adicionar nó</p>
            <div className="space-y-1.5">
              {PALETTE.map((item) => {
                const meta = NODE_META[item.type];
                return (
                  <button
                    key={item.type}
                    onClick={() => canEditar && addNode(item.type, item.defaultData)}
                    disabled={!canEditar}
                    className="focus-ring flex w-full items-center gap-2 rounded-card border border-border px-2.5 py-2 text-left text-sm hover:bg-surface-alt disabled:opacity-60"
                  >
                    <meta.icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <button
          onClick={() => setPaletteCollapsed((c) => !c)}
          className="focus-ring absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-r-card border border-l-0 border-border bg-surface p-1 text-muted hover:bg-surface-alt"
          style={{ left: paletteCollapsed ? 0 : 224 }}
          aria-label={paletteCollapsed ? "Expandir painel de nós" : "Recolher painel de nós"}
          title={paletteCollapsed ? "Expandir painel de nós" : "Recolher painel de nós"}
        >
          {paletteCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Canvas */}
        <div
          className="relative flex-1 overflow-auto bg-bg"
          style={{ backgroundImage: "radial-gradient(circle, var(--color-border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={() => {
            setSelectedNodeId(null);
            setPendingConnection(null);
          }}
        >
          <svg className="pointer-events-none absolute left-0 top-0" width="100%" height="100%" style={{ minWidth: 1600, minHeight: 1000 }}>
            {edges.map((edge) => {
              const source = nodes.find((n) => n.id === edge.sourceNodeId);
              const target = nodes.find((n) => n.id === edge.targetNodeId);
              if (!source || !target) return null;
              const x1 = source.positionX + NODE_WIDTH;
              const y1 = source.positionY + 28;
              const x2 = target.positionX;
              const y2 = target.positionY + 28;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                />
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-primary)" />
              </marker>
            </defs>
          </svg>

          <div style={{ minWidth: 1600, minHeight: 1000, position: "relative" }}>
            {nodes.map((node) => {
              const meta = NODE_META[node.type];
              const outputs = nodeOutputs.get(node.id) ?? [];
              const isPendingSource = pendingConnection?.sourceNodeId === node.id;
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el && node.isNew && !scrolledIntoViewRef.current.has(node.id)) {
                      scrolledIntoViewRef.current.add(node.id);
                      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                    }
                  }}
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pendingConnection) completeConnection(node.id);
                    else setSelectedNodeId(node.id);
                  }}
                  className={`shadow-soft absolute cursor-grab select-none rounded-card border bg-surface p-3 active:cursor-grabbing ${
                    selectedNodeId === node.id ? "border-primary ring-2 ring-primary/30" : "border-border"
                  }`}
                  style={{ left: node.positionX, top: node.positionY, width: NODE_WIDTH }}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: meta.color }}>
                    <meta.icon className="h-3.5 w-3.5 shrink-0" /> {meta.label}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">{nodePreview(node)}</p>

                  {node.type !== "START" && canEditar && (
                    <button
                      data-connector
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNode(node.id);
                      }}
                      className="focus-ring absolute -right-2 -top-2 rounded-full border border-border bg-surface p-1 text-muted hover:bg-red-50 hover:text-red-600"
                      aria-label="Excluir nó"
                      title="Excluir nó"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}

                  {outputs.length <= 1 && node.type !== "END" && (
                    <button
                      data-connector
                      onClick={(e) => {
                        e.stopPropagation();
                        startConnection(node.id, null);
                      }}
                      title="Arraste uma ligação: clique aqui e depois no nó de destino"
                      className={`focus-ring absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-surface ${
                        isPendingSource ? "animate-pulse bg-primary" : "bg-muted"
                      }`}
                    />
                  )}

                  {outputs.length > 1 && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      {outputs.map((out) => (
                        <div key={out.handle} className="flex items-center justify-between gap-1 text-[11px] text-muted">
                          <span className="truncate">{out.label}</span>
                          <button
                            data-connector
                            onClick={(e) => {
                              e.stopPropagation();
                              startConnection(node.id, out.handle ?? null);
                            }}
                            className={`h-3 w-3 shrink-0 rounded-full border-2 border-surface ${
                              pendingConnection?.sourceNodeId === node.id && pendingConnection.sourceHandle === out.handle ? "animate-pulse bg-primary" : "bg-muted"
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Node inspector */}
        {selectedNode && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-border bg-surface p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              {(() => {
                const Icon = NODE_META[selectedNode.type].icon;
                return <Icon className="h-4 w-4" style={{ color: NODE_META[selectedNode.type].color }} />;
              })()}
              {NODE_META[selectedNode.type].label}
            </p>

            {selectedNode.type === "TEXT_MESSAGE" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Texto da mensagem</span>
                <textarea
                  disabled={!canEditar}
                  value={(selectedNode.data as { text?: string }).text ?? ""}
                  onChange={(e) => updateNodeData(selectedNode.id, { text: e.target.value })}
                  rows={5}
                  className="focus-ring w-full resize-none rounded-card border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-60"
                />
              </label>
            )}

            {selectedNode.type === "MENU" && (
              <MenuOptionsEditor
                disabled={!canEditar}
                options={(selectedNode.data as { options?: { id: string; label: string }[] }).options ?? []}
                onChange={(options) => updateNodeData(selectedNode.id, { options })}
              />
            )}

            {selectedNode.type === "TRANSFER_TO_AGENT" && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">
                  Atendentes designados — ver PROMPT: "para quais atendentes serão designados". Deixe vazio para qualquer atendente disponível.
                </p>
                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-card border border-border">
                  {agents?.length === 0 && <p className="p-3 text-center text-xs text-muted">Nenhum atendente disponível.</p>}
                  {agents?.map((agent) => {
                    const assignedIds = (selectedNode.data as { assignedAgentIds?: string[] }).assignedAgentIds ?? [];
                    const checked = assignedIds.includes(agent.id);
                    return (
                      <label key={agent.id} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0 hover:bg-surface-alt">
                        <input
                          type="checkbox"
                          disabled={!canEditar}
                          checked={checked}
                          onChange={() =>
                            updateNodeData(selectedNode.id, {
                              assignedAgentIds: checked ? assignedIds.filter((aid) => aid !== agent.id) : [...assignedIds, agent.id],
                            })
                          }
                          className="h-4 w-4 accent-primary"
                        />
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRESENCE_DOT[agent.presence]}`} />
                        <span className="truncate">{agent.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {(selectedNode.type === "START" || selectedNode.type === "END") && (
              <p className="text-xs text-muted">
                {selectedNode.type === "START" ? "Ponto de entrada do fluxo — toda conversa começa por aqui." : "Encerra o fluxo e devolve a conversa para o atendimento normal."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuOptionsEditor({
  options,
  onChange,
  disabled,
}: {
  options: { id: string; label: string }[];
  onChange: (options: { id: string; label: string }[]) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">Opções (cada uma vira uma saída deste nó)</p>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center gap-1.5">
            <input
              disabled={disabled}
              value={opt.label}
              onChange={(e) => onChange(options.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)))}
              placeholder={`Opção ${i + 1}`}
              className="focus-ring min-w-0 flex-1 rounded-card border border-border bg-transparent px-2 py-1.5 text-sm disabled:opacity-60"
            />
            {!disabled && (
              <button
                onClick={() => onChange(options.filter((_, j) => j !== i))}
                className="focus-ring shrink-0 rounded-card p-1 text-muted hover:bg-red-50 hover:text-red-600"
                aria-label="Remover opção"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          onClick={() => onChange([...options, { id: crypto.randomUUID(), label: "" }])}
          className="focus-ring mt-2 text-xs font-medium text-primary hover:underline"
        >
          + Adicionar opção
        </button>
      )}
    </div>
  );
}
