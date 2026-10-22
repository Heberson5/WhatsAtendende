import { describe, it, expect } from "vitest";
import { COLUMN_SCREENS, customerFirstName, fillCustomerTags, firstNameOf, mergeColumnView } from "@whatsatendende/types";
import { fillAutoMessageTags } from "./auto-message-tags";

describe("tag {{primeiro_nome}}", () => {
  it("é a primeira palavra do nome, com só a inicial maiúscula quando o nome está todo em maiúsculas ou minúsculas", () => {
    expect(firstNameOf("MARIA DA SILVA")).toBe("Maria");
    expect(firstNameOf("joão pedro")).toBe("João");
    expect(firstNameOf("  Ana Paula  ")).toBe("Ana");
    expect(firstNameOf("McDonald Souza")).toBe("McDonald");
  });

  it("sem nome salvo a conversa usa o número, que fica inteiro", () => {
    expect(firstNameOf("5565999990000")).toBe("5565999990000");
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf(null)).toBe("");
  });

  it("troca {{primeiro_nome}} e {{cliente}} no texto", () => {
    expect(fillCustomerTags("Oi, {{primeiro_nome}}! ({{ cliente }})", "CARLOS ALBERTO")).toBe("Oi, Carlos! (CARLOS ALBERTO)");
  });

  it("a prévia de Aceite, Transferência e Encerramento mostra o primeiro nome", () => {
    const text = fillAutoMessageTags("Olá, {{primeiro_nome}}! Aqui é {{atendente}}.", { atendente: "Ana", atendenteNome: "Ana Paula", atendenteCargo: "Atendente", cliente: "Maria Cliente" });
    expect(text).toBe("Olá, Maria! Aqui é Ana.");
  });

  it("o Primeiro nome salvo no contato vale no lugar do automático", () => {
    expect(customerFirstName("MARIA DA SILVA", "Mari")).toBe("Mari");
    expect(customerFirstName("MARIA DA SILVA", "  ")).toBe("Maria");
    expect(fillCustomerTags("Oi, {{primeiro_nome}}!", "MARIA DA SILVA", "Mari")).toBe("Oi, Mari!");
  });

  it("a coluna Primeiro nome de Contatos começa oculta e aparece quando a visão salva a liga", () => {
    expect(COLUMN_SCREENS.contatos.columns.some((c) => c.key === "firstName")).toBe(true);
    expect(mergeColumnView("contatos", null).find((c) => c.key === "firstName")?.visible).toBe(false);
    expect(mergeColumnView("contatos", null).find((c) => c.key === "phone")?.visible).toBe(true);
    expect(mergeColumnView("contatos", [{ key: "firstName", visible: true }]).find((c) => c.key === "firstName")?.visible).toBe(true);
  });
});
