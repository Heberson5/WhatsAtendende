import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SatisfactionReportDTO } from "@whatsatendende/types";
import { SatisfactionReport } from "./SatisfactionReport";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { get: vi.fn() }, getApiErrorMessage: () => "Erro" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// Charts measure their box with ResizeObserver, which the test DOM doesn't have.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
vi.mock("../gestao/ReadOnlyConversationDrawer", () => ({
  ReadOnlyConversationDrawer: ({ conversation }: { conversation: { id: string } }) => <p>Conversa aberta: {conversation.id}</p>,
}));

const stats = { sent: 4, answered: 3, responseRate: 75, average: 6.3, nps: 0, promoters: 1, passives: 1, detractors: 1 };
const response = (id: string, contactName: string, score: number | null, category: "promoter" | "passive" | "detractor" | null) => ({
  surveyId: id,
  conversationId: `conv-${id}`,
  sentAt: "2026-10-05T12:00:00.000Z",
  answeredAt: score === null ? null : "2026-10-05T12:05:00.000Z",
  contactName,
  contactPhone: "5565999990001",
  agentName: "Lucas",
  connectionName: "Suporte",
  surveyName: "Pesquisa",
  question: "De 0 a 10?",
  score,
  category,
  status: score === null ? ("awaiting" as const) : ("answered" as const),
});
const REPORT: SatisfactionReportDTO = {
  totals: { ...stats, distribution: [0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1], awaiting: 1 },
  byAgent: [{ ...stats, agentId: "lucas", agentName: "Lucas", lowest: 3, highest: 10 }],
  byConnection: [{ ...stats, connectionId: "s", connectionName: "Suporte", connectionColor: "#0097B4" }],
  trend: [],
  responses: [response("1", "Marina Alves", 10, "promoter"), response("2", "Rita Souza", 3, "detractor"), response("3", "Paulo Lima", 8, "passive"), response("4", "Sem Resposta", null, null)],
};

function renderReport() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SatisfactionReport period={{ period: "month" }} connectionIds={[]} />
    </QueryClientProvider>
  );
}

describe("Relatórios › Pesquisa de satisfação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/reports/satisfaction") return Promise.resolve({ data: REPORT }) as never;
      return Promise.resolve({ data: { id: url.split("/").at(-1) } }) as never;
    });
  });

  it("mostra NPS, média, respostas e as notas de cada atendente", async () => {
    renderReport();
    expect(await screen.findByText("Zona de aperfeiçoamento")).toBeInTheDocument();
    expect(screen.getAllByText("6,3").length).toBeGreaterThan(0);
    expect(screen.getByText(/de 4 enviadas · 75% · 1 aguardando/)).toBeInTheDocument();
    const agents = screen.getByRole("region", { name: "Notas por atendente" });
    expect(within(agents).getByText("Lucas")).toBeInTheDocument();
    expect(within(agents).getByText("3 / 10")).toBeInTheDocument();
  });

  it("filtra as respostas por classificação e cliente, e abre a conversa avaliada", async () => {
    renderReport();
    const answers = await screen.findByRole("region", { name: "Respostas" });
    expect(within(answers).getByText("Marina Alves")).toBeInTheDocument();
    expect(within(answers).queryByText("Sem Resposta")).not.toBeInTheDocument();

    fireEvent.click(within(answers).getByRole("button", { name: "Detratores (0–6)" }));
    expect(within(answers).getByText("Rita Souza")).toBeInTheDocument();
    expect(within(answers).queryByText("Marina Alves")).not.toBeInTheDocument();

    fireEvent.click(within(answers).getByRole("button", { name: "Sem resposta" }));
    expect(within(answers).getByText("Sem Resposta")).toBeInTheDocument();

    fireEvent.click(within(answers).getByRole("button", { name: "Respondidas" }));
    fireEvent.change(within(answers).getByLabelText("Buscar cliente nas respostas"), { target: { value: "paulo" } });
    expect(within(answers).getAllByRole("row")).toHaveLength(2); // header + Paulo

    fireEvent.click(within(answers).getByRole("button", { name: "Ver a conversa avaliada de Paulo Lima" }));
    expect(await screen.findByText("Conversa aberta: conv-3")).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/conversations/conv-3"));
  });
});
