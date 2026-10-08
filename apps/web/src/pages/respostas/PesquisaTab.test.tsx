import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERMISSION, type PermissionMap, type SatisfactionSurveySettingsDTO } from "@whatsatendende/types";
import { PesquisaTab } from "./PesquisaTab";
import { api } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";

vi.mock("../../lib/api", () => ({
  api: { get: vi.fn(), put: vi.fn() },
  getApiErrorMessage: () => "erro",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings: SatisfactionSurveySettingsDTO = {
  enabled: true,
  connectionScope: { allConnections: true, connections: [] },
  question: "De 0 a 10, o quanto você recomendaria o atendimento?",
  thanks: "Obrigado pela sua avaliação!",
  answerWindowHours: 24,
  closingWaitMinutes: 30,
};

function renderTab(canEdit = true) {
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/satisfaction-survey/settings") return Promise.resolve({ data: settings });
    return Promise.resolve({ data: [] }); // /whatsapp/connections
  }) as never);
  // The server answers with the saved settings, in the DTO shape (the scope comes back with its connections).
  vi.mocked(api.put).mockImplementation(((_url: string, body: Omit<SatisfactionSurveySettingsDTO, "connectionScope">) =>
    Promise.resolve({ data: { ...settings, question: body.question, thanks: body.thanks, answerWindowHours: body.answerWindowHours, closingWaitMinutes: body.closingWaitMinutes } })) as never);
  useAuthStore.setState({ permissions: { [PERMISSION.RESPOSTAS_PESQUISA_EDITAR]: canEdit } as unknown as PermissionMap });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PesquisaTab />
    </QueryClientProvider>,
  );
}

const waitField = () => screen.findByLabelText(/Se o cliente não responder, enviar a mensagem de encerramento em/);

describe("Respostas › Pesquisa: espera da mensagem de encerramento", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
  });

  it("mostra o tempo de espera salvo (30 minutos por padrão)", async () => {
    renderTab();
    expect(await waitField()).toHaveValue(30);
  });

  it("explica a nova ordem: a mensagem de encerramento não vai junto com a pergunta", async () => {
    renderTab();
    await waitField();
    expect(screen.getByText(/não vai junto com ela: é enviada 10 segundos depois que o cliente responde a nota/)).toBeInTheDocument();
    expect(screen.queryByText(/enviada logo antes da pergunta/)).not.toBeInTheDocument();
  });

  it("mudar o tempo acende a barra de alterações não salvas e salva o valor novo", async () => {
    renderTab();
    const field = await waitField();
    expect(screen.queryByText("Você tem alterações não salvas")).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: "45" } });
    expect(screen.getByText("Você tem alterações não salvas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0][1]).toMatchObject({ closingWaitMinutes: 45, answerWindowHours: 24 });
  });

  it.each(["0", "721", ""])("o valor %j não pode ser salvo", async (value) => {
    renderTab();
    const field = await waitField();
    fireEvent.change(field, { target: { value } });
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    expect(screen.getByText("Use um valor de 1 a 720 minutos.")).toBeInTheDocument();
  });

  it("a espera não pode passar do tempo que o cliente tem para responder", async () => {
    renderTab();
    const field = await waitField();
    fireEvent.change(screen.getByLabelText(/Aceitar resposta por até \(horas\)/), { target: { value: "1" } });
    fireEvent.change(field, { target: { value: "90" } });
    expect(screen.getByRole("alert")).toHaveTextContent("A espera não pode ser maior que o tempo para o cliente responder (1 h).");
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();

    fireEvent.change(field, { target: { value: "60" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
  });

  it("quem não pode editar vê o campo travado", async () => {
    renderTab(false);
    const field = await waitField();
    expect(field).toBeDisabled();
    expect(screen.queryByText("Você tem alterações não salvas")).not.toBeInTheDocument();
  });
});
