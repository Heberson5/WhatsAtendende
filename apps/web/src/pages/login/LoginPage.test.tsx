import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "./LoginPage";
import { useAuthStore } from "../../store/auth-store";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn() },
  getApiErrorMessage: () => "Nao foi possivel entrar",
}));

function renderLoginPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, hydrated: true });
    vi.mocked(api.get).mockResolvedValue({ data: { companyName: "WhatsAtendende", primaryColor: "#0097B4", secondaryColor: "#FFE450", logoUrl: null, faviconUrl: null } } as never);
    vi.mocked(api.post).mockReset();
  });

  it("renders e-mail, password and submit fields", () => {
    renderLoginPage();
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar/i })).toBeInTheDocument();
  });

  it("toggles password visibility", () => {
    renderLoginPage();
    const passwordInput = screen.getByLabelText(/^senha$/i) as HTMLInputElement;
    expect(passwordInput.type).toBe("password");
    fireEvent.click(screen.getByLabelText(/mostrar senha/i));
    expect(passwordInput.type).toBe("text");
  });

  it("submits credentials and stores the session on success", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { accessToken: "token-123", user: { id: "1", displayName: "Admin", role: "ADMIN", email: "admin@test.dev" } },
    } as never);

    renderLoginPage();
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: "admin@test.dev" } });
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: "Admin@123" } });
    fireEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe("token-123"));
    expect(api.post).toHaveBeenCalledWith("/auth/login", { email: "admin@test.dev", password: "Admin@123" });
  });

  it("shows an error message when login fails", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("invalid"));

    renderLoginPage();
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: "admin@test.dev" } });
    fireEvent.change(screen.getByLabelText(/^senha$/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/nao foi possivel entrar/i);
  });
});
