import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { phoneKey } from "../src/lib/phone-key";
import { downloadCandidates, assertReadOnlyQuery, fetchFromLink, parseSpreadsheet } from "../src/modules/data-sources/data-source-fetch";
import { parseBeneficiaries, syncDueDataSources } from "../src/modules/data-sources/data-sources.service";
import { resetDatabase, createTestUser, createWaitingConversation, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

// Fictitious data in the shape the WhatsAtendende script produces (SQL Server Management Studio CSV).
const CSV = [
  "telefone_whatsapp,codigo_cliente,nome_cliente,cpf_cnpj,numero_contrato,plano,situacao_contrato,beneficiarios,parcelas_suspensao,documento,vencimento_parcela,dias_em_atraso,saldo,multa,juros,valor_atualizado,forma_pagamento",
  "5565999990001,10,Maria Teste,12345678901,C-1,Plano Ouro,Ativo,Maria Teste;Titular;01/02/1980;Não | João Teste;Filho;15/06/2010;Não,2,D-1,10/08/2026,70,89.90,1.80,2.10,93.80,Boleto",
  "5565999990001,10,Maria Teste,12345678901,C-1,Plano Ouro,Ativo,Maria Teste;Titular;01/02/1980;Não | João Teste;Filho;15/06/2010;Não,2,D-2,10/09/2026,39,89.90,1.80,1.17,92.87,Boleto",
  "5565999990001,10,Maria Teste,12345678901,C-1,Plano Ouro,Ativo,Maria Teste;Titular;01/02/1980;Não | João Teste;Filho;15/06/2010;Não,2,D-3,10/11/2026,0,89.90,0.00,0.00,89.90,Boleto",
  "6599990002,20,Ana Um,11122233344,C-2,Plano Prata,Ativo,,3,,,,,,,,",
  "556599990002,21,Ana Dois,55566677788,C-3,Plano Prata,Ativo,,3,,,,,,,,",
].join("\n");

describe("Fontes de dados", () => {
  let adminToken: string;
  let agentToken: string;
  let agentId: string;
  let connectionId: string;
  let sourceId: string;

  async function conversationFor(phone: string) {
    const { conversation } = await createWaitingConversation(phone, connectionId);
    return prisma.conversation.update({ where: { id: conversation.id }, data: { status: "IN_PROGRESS", assignedAgentId: agentId, acceptedAt: new Date() } });
  }

  beforeAll(async () => {
    await resetDatabase();
    await prisma.dataSource.deleteMany();
    await createTestUser({ email: "admin-ds@test.dev", role: "ADMIN" });
    adminToken = await loginAs("admin-ds@test.dev");
    const connection = await request(app).post("/api/whatsapp/connections").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dados" });
    connectionId = connection.body.id;
    await request(app).post(`/api/whatsapp/connections/${connectionId}/connect`).set("Authorization", `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 2200)); // mock provider: QR -> CONNECTED takes ~1.9s
    agentId = (await createTestUser({ email: "ana-ds@test.dev", role: "AGENT", whatsappConnectionId: connectionId })).id;
    agentToken = await loginAs("ana-ds@test.dev");
  }, 15000);

  afterAll(async () => {
    await prisma.dataSource.deleteMany();
    await prisma.$disconnect();
  });

  it("normaliza o telefone com ou sem 55 e com ou sem o 9", () => {
    expect(phoneKey("(65) 99999-0001")).toBe("556599990001");
    expect(phoneKey("5565999990001")).toBe("556599990001");
    expect(phoneKey("556599990001")).toBe("556599990001");
    expect(phoneKey("065999990001")).toBe("556599990001");
    expect(phoneKey("12345")).toBeNull();
  });

  it("monta o link de download do OneDrive e do Google Planilhas", () => {
    expect(downloadCandidates("https://docs.google.com/spreadsheets/d/abc123/edit#gid=7")).toEqual(["https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=7"]);
    expect(downloadCandidates("https://1drv.ms/x/s!AbC")[0]).toMatch(/^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u!/);
    expect(downloadCandidates("https://empresa.sharepoint.com/:x:/g/abc")).toEqual(["https://empresa.sharepoint.com/:x:/g/abc?download=1"]);
    expect(downloadCandidates("https://drive.google.com/file/d/1AbC-xyz/view?usp=sharing")).toEqual(["https://drive.google.com/uc?export=download&id=1AbC-xyz"]);
  });

  it("link do OneDrive recusado pela Microsoft: explica e indica a conta Microsoft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    try {
      await expect(fetchFromLink("https://1drv.ms/x/c/4a75/IQBb?e=abc")).rejects.toThrow(/Planilha privada \(conta Microsoft\)/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lê o CSV salvo pelo SSMS ou Excel em UTF-8, Unicode ou ANSI", async () => {
    const csv = "Nome,Cidade\r\nJosé,\"Cuiabá, MT\"\r\n";
    for (const buffer of [Buffer.from(csv, "utf8"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]), Buffer.from(csv, "latin1")]) {
      expect((await parseSpreadsheet(buffer, null)).rows).toEqual([{ nome: "José", cidade: "Cuiabá, MT" }]);
    }
  });

  it("lê o XLSX direto (só a primeira aba), com as datas como 10/11/2026", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Clientes");
    sheet.addRow(["Nome", "Telefone", "Vencimento", "Valor"]);
    sheet.addRow(["José", "(65) 99999-0000", new Date(Date.UTC(2026, 10, 10)), 1234.56]);
    workbook.addWorksheet("Outra").addRow(["ignorada"]);
    const table = await parseSpreadsheet(Buffer.from(await workbook.xlsx.writeBuffer()), null);
    expect(table.rows).toEqual([{ nome: "José", telefone: "(65) 99999-0000", vencimento: "10/11/2026", valor: "1234.56" }]);
  });

  it("acha sozinho a coluna do telefone com outro nome; sem nenhuma, guarda as colunas para escolher", async () => {
    const created = await request(app).post("/api/data-sources").set("Authorization", `Bearer ${adminToken}`).send({ name: "ERP", kind: "UPLOAD" });
    const upload = (csv: string) =>
      request(app).post(`/api/data-sources/${created.body.id}/upload`).set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from(csv), { filename: "erp.csv", contentType: "text/csv" });
    expect((await upload("Contrato;Celular\nC1;(65) 99999-0001\n")).body).toMatchObject({ rowCount: 1, lastSyncError: null, columnMap: { phone: "celular" } });

    await prisma.dataSource.update({ where: { id: created.body.id }, data: { columnMap: {} } });
    const missing = (await upload("Contrato;Contato\nC1;(65) 99999-0001\n")).body;
    expect(missing.lastSyncError).toContain("Editar");
    expect(missing.columns).toEqual(["contrato", "contato"]);
  });

  it("só aceita consulta de leitura no banco", () => {
    expect(() => assertReadOnlyQuery("SELECT * FROM clientes")).not.toThrow();
    expect(() => assertReadOnlyQuery("WITH x AS (SELECT 1 a) SELECT * FROM x")).not.toThrow();
    expect(() => assertReadOnlyQuery("DELETE FROM clientes")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT 1; DROP TABLE x")).toThrow();
  });

  it("lê titular e beneficiários com idade e agregado", () => {
    const list = parseBeneficiaries("Maria;Titular;01/02/1980;Não | João;Filho;15/06/2010;Sim", new Date(2026, 9, 19));
    expect(list).toEqual([
      { name: "Maria", relation: "Titular", age: 46, aggregated: false, holder: true },
      { name: "João", relation: "Filho", age: 16, aggregated: true, holder: false },
    ]);
  });

  it("sem fonte ativa: nada aparece e a tag não deixa enviar", async () => {
    const conversation = await conversationFor("5565999990001");
    const data = await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${agentToken}`);
    expect(data.body.status).toBe("NO_SOURCE");
    expect((await request(app).get("/api/data-sources/tags").set("Authorization", `Bearer ${agentToken}`)).body).toEqual({ available: false, columns: [] });
  });

  it("arquivo enviado vira a fonte, com contratos, parcelas, beneficiários e suspensão", async () => {
    const created = await request(app).post("/api/data-sources").set("Authorization", `Bearer ${adminToken}`).send({ name: "Planilha", kind: "UPLOAD" });
    expect(created.status).toBe(201);
    sourceId = created.body.id;
    const uploaded = await request(app)
      .post(`/api/data-sources/${sourceId}/upload`)
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", Buffer.from(CSV), { filename: "whatsatendende.csv", contentType: "text/csv" });
    expect(uploaded.body).toMatchObject({ rowCount: 5, lastSyncError: null, status: "INACTIVE" });
    expect(uploaded.body.columnMap).toMatchObject({ phone: "telefone_whatsapp", contract: "numero_contrato", suspensionThreshold: "parcelas_suspensao" });
    await request(app).post(`/api/data-sources/${sourceId}/active`).set("Authorization", `Bearer ${adminToken}`).send({ active: true }).expect(200);

    const conversation = await prisma.conversation.findFirstOrThrow({ where: { contact: { phone: "5565999990001" } } });
    const data = (await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(data.status).toBe("OK");
    expect(data.client.name).toBe("Maria Teste");
    const [contract] = data.client.contracts;
    expect(contract).toMatchObject({ number: "C-1", overdueCount: 2, suspensionThreshold: 2, suspended: true });
    expect(contract.parcels.map((p: { document: string }) => p.document)).toEqual(["D-1", "D-2", "D-3"]);
    expect(contract.parcels[0]).toMatchObject({ value: "89.90", fine: "1.80", interest: "2.10", updatedValue: "93.80" });
    expect(contract.beneficiaries.map((b: { name: string; holder: boolean }) => [b.name, b.holder])).toEqual([["Maria Teste", true], ["João Teste", false]]);
    expect(data.suspensionWarningPending).toBe(true);
    expect(data.client.fields.find((f: { column: string }) => f.column === "cpf_cnpj").value).not.toContain("12345678");

    await request(app).post(`/api/conversations/${conversation.id}/client-data/suspension-ack`).set("Authorization", `Bearer ${agentToken}`).expect(204);
    const again = (await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(again.suspensionWarningPending).toBe(false);
  });

  it("dado sensível só é revelado com permissão, e fica na auditoria", async () => {
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { contact: { phone: "5565999990001" } } });
    const denied = await request(app).post(`/api/conversations/${conversation.id}/client-data/reveal`).set("Authorization", `Bearer ${agentToken}`).send({ column: "cpf_cnpj" });
    expect(denied.status).toBe(403);
    const revealed = await request(app).post(`/api/conversations/${conversation.id}/client-data/reveal`).set("Authorization", `Bearer ${adminToken}`).send({ column: "cpf_cnpj" });
    expect(revealed.body.value).toBe("12345678901");
    expect(await prisma.auditLog.count({ where: { action: "CLIENT_SENSITIVE_DATA_REVEALED", entityId: conversation.id } })).toBe(1);
  });

  it("tags: preenche, e trava o envio quando falta o dado", async () => {
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { contact: { phone: "5565999990001" } } });
    const rendered = await request(app)
      .post(`/api/conversations/${conversation.id}/client-data/render`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ text: "Olá {{dados.nome_cliente}}, contrato {{dados.numero_contrato}}" });
    expect(rendered.body).toEqual({ text: "Olá Maria Teste, contrato C-1", missing: [] });

    const blocked = await request(app)
      .post(`/api/messages/conversations/${conversation.id}/text`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ body: "Seu e-mail: {{dados.email}}" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain("*email*");
    const sensitive = await request(app)
      .post(`/api/conversations/${conversation.id}/client-data/render`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ text: "CPF {{dados.cpf_cnpj}}" });
    expect(sensitive.body.missing).toEqual(["cpf_cnpj"]);
  });

  it("telefone de vários clientes: o atendente escolhe", async () => {
    const conversation = await conversationFor("556599990002");
    const data = (await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(data.client).toBeNull();
    expect(data.clients).toEqual([
      { key: "20", name: "Ana Um", cpfPartial: "***.222.333-**" },
      { key: "21", name: "Ana Dois", cpfPartial: "***.666.777-**" },
    ]);
    const chosen = await request(app).put(`/api/conversations/${conversation.id}/client-data/client`).set("Authorization", `Bearer ${agentToken}`).send({ clientKey: "21" });
    expect(chosen.body.client.name).toBe("Ana Dois");
  });

  it("respostas rápidas com tag somem para o atendente sem fonte e aparecem marcadas para a gestão", async () => {
    await request(app)
      .post("/api/quick-replies")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Contrato", shortcut: "contrato", text: "Seu contrato é {{dados.numero_contrato}}", connectionScope: { allConnections: true, connectionIds: [] } })
      .expect(201);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { contact: { phone: "5565999990001" } } });
    const withSource = (await request(app).get(`/api/quick-replies/conversation/${conversation.id}`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(withSource.find((r: { shortcut: string }) => r.shortcut === "contrato").filledText).toBe("Seu contrato é C-1");

    await prisma.dataSource.update({ where: { id: sourceId }, data: { dataUpdatedAt: new Date(Date.now() - 25 * 3_600_000) } });
    const agentList = (await request(app).get(`/api/quick-replies/conversation/${conversation.id}`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(agentList.find((r: { shortcut: string }) => r.shortcut === "contrato")).toBeUndefined();
    const stale = (await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${agentToken}`)).body;
    expect(stale).toMatchObject({ status: "UNAVAILABLE", reason: null });
    const adminView = (await request(app).get(`/api/conversations/${conversation.id}/client-data`).set("Authorization", `Bearer ${adminToken}`)).body;
    expect(adminView.reason).toContain("prazo");
  });

  it("erro na atualização avisa a gestão e deixa os dados indisponíveis", async () => {
    const link = await request(app)
      .post("/api/data-sources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Link", kind: "LINK", config: { url: "http://127.0.0.1:9/planilha.csv" } });
    await request(app).post(`/api/data-sources/${link.body.id}/active`).set("Authorization", `Bearer ${adminToken}`).send({ active: true }).expect(200);
    const after = await prisma.dataSource.findUniqueOrThrow({ where: { id: link.body.id } });
    expect(after.lastSyncError).toBeTruthy();
    expect(await prisma.dataSource.count({ where: { active: true } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "DATA_SOURCE_ERROR" } })).toBeGreaterThan(0);
    await syncDueDataSources(new Date(Date.now() + 2 * 3_600_000));
  });
});
