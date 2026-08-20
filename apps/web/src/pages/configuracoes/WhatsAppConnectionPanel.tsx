import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Plug, PlugZap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "../../lib/api";
import { getSocket } from "../../lib/socket";

interface WhatsAppStatus {
  state: "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CONNECTED";
  qrCodeDataUrl: string | null;
  connectedNumber: string | null;
  lastConnectedAt: string | null;
}

const STATE_LABEL: Record<string, string> = {
  DISCONNECTED: "Desconectado",
  CONNECTING: "Conectando",
  QR_PENDING: "Aguardando leitura do QR Code",
  CONNECTED: "Conectado",
};

const STATE_COLOR: Record<string, string> = {
  DISCONNECTED: "bg-gray-100 text-gray-600",
  CONNECTING: "bg-secondary/40 text-secondary-fg",
  QR_PENDING: "bg-secondary/40 text-secondary-fg",
  CONNECTED: "bg-green-100 text-green-700",
};

export function WhatsAppConnectionPanel() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: async () => (await api.get<WhatsAppStatus>("/whatsapp/status")).data,
    refetchInterval: (query) => (query.state.data?.state === "CONNECTED" ? false : 2000),
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] });
    socket.on("whatsapp:status", handler);
    return () => {
      socket.off("whatsapp:status", handler);
    };
  }, [queryClient]);

  const connectMutation = useMutation({
    mutationFn: () => api.post("/whatsapp/connect"),
    onError: (err) => toast.error(getApiErrorMessage(err)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] }),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => api.post("/whatsapp/disconnect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] }),
  });
  const reconnectMutation = useMutation({
    mutationFn: () => api.post("/whatsapp/reconnect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] }),
  });

  const state = status?.state ?? "DISCONNECTED";

  return (
    <div className="shadow-soft max-w-xl rounded-card border border-border bg-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Conexão com o WhatsApp</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      {state === "CONNECTED" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-card bg-green-50 px-4 py-3 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <div>
              <p className="text-sm font-medium">Número conectado: {status?.connectedNumber}</p>
              {status?.lastConnectedAt && (
                <p className="text-xs opacity-80">Desde {format(new Date(status.lastConnectedAt), "dd/MM/yyyy HH:mm")}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => reconnectMutation.mutate()}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-4 py-2 text-sm font-medium hover:bg-surface-alt"
            >
              <RefreshCw className="h-4 w-4" /> Reconectar
            </button>
            <button
              onClick={() => disconnectMutation.mutate()}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Plug className="h-4 w-4" /> Desconectar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {status?.qrCodeDataUrl ? (
            <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border p-6">
              {status.qrCodeDataUrl.startsWith("data:") ? (
                <img src={status.qrCodeDataUrl} alt="QR Code do WhatsApp" className="h-56 w-56" />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center break-all bg-surface-alt p-4 text-center text-[10px] text-muted">
                  {status.qrCodeDataUrl}
                  <br />
                  (simulação — provider mock)
                </div>
              )}
              <p className="text-center text-sm text-muted">Abra o WhatsApp no celular, toque em Aparelhos conectados e escaneie o código.</p>
            </div>
          ) : (
            <div className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted">
              {state === "CONNECTING" ? "Gerando QR Code..." : "Nenhuma sessão ativa."}
            </div>
          )}

          <button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending || state === "CONNECTING"}
            className="focus-ring flex w-full items-center justify-center gap-2 rounded-card bg-primary py-2.5 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            <PlugZap className="h-4 w-4" /> Conectar WhatsApp
          </button>
        </div>
      )}
    </div>
  );
}
