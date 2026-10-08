import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestUser, TEST_PASSWORD } from "./helpers";

const app = createApp();
const QUESTION = "De 0 a 10, o quanto você recomendaria o atendimento?";

describe("Respostas › Pesquisa: configuração da espera da mensagem de encerramento", () => {
  let token: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    enabled: false,
    connectionScope: { allConnections: true, connectionIds: [] },
    question: QUESTION,
    thanks: "Obrigado!",
    answerWindowHours: 24,
    closingWaitMinutes: 30,
    ...overrides,
  });
  const put = (payload: Record<string, unknown>) => request(app).put("/api/satisfaction-survey/settings").set("Authorization", `Bearer ${token}`).send(payload);
  const get = () => request(app).get("/api/satisfaction-survey/settings").set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-pesquisa@test.dev", role: "ADMIN" });
    token = (await request(app).post("/api/auth/login").send({ email: "admin-pesquisa@test.dev", password: TEST_PASSWORD })).body.accessToken;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sem nada salvo, a espera padrão é de 30 minutos", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.closingWaitMinutes).toBe(30);
  });

  it("guarda o valor escolhido, devolve na leitura e registra na auditoria", async () => {
    const res = await put(body({ closingWaitMinutes: 45 }));
    expect(res.status).toBe(200);
    expect(res.body.closingWaitMinutes).toBe(45);
    expect((await get()).body.closingWaitMinutes).toBe(45);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "SATISFACTION_SURVEY_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ closingWaitMinutes: 45, answerWindowHours: 24 });
  });

  it.each([0, 721, 1.5, -5])("recusa %s minutos", async (minutes) => {
    const res = await put(body({ closingWaitMinutes: minutes }));
    expect(res.status).toBe(400);
  });

  it("aceita os extremos de 1 a 720 minutos (12 horas), desde que caibam no tempo para responder", async () => {
    expect((await put(body({ closingWaitMinutes: 1 }))).status).toBe(200);
    expect((await put(body({ closingWaitMinutes: 720, answerWindowHours: 12 }))).status).toBe(200);
    expect((await get()).body).toMatchObject({ closingWaitMinutes: 720, answerWindowHours: 12 });
  });

  it("a espera não pode ser maior que o tempo que o cliente tem para responder", async () => {
    const tooLong = await put(body({ answerWindowHours: 1, closingWaitMinutes: 61 }));
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).toContain("A espera pela nota não pode ser maior");

    expect((await put(body({ answerWindowHours: 1, closingWaitMinutes: 60 }))).status).toBe(200);
  });

  it("uma tela aberta antes desta versão (sem o campo) salva com o padrão, sem erro", async () => {
    const { closingWaitMinutes: _omitted, ...withoutField } = body();
    void _omitted;
    const res = await put(withoutField);
    expect(res.status).toBe(200);
    expect(res.body.closingWaitMinutes).toBe(30);
  });
});
