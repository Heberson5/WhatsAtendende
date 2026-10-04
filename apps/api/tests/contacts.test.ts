import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { normalizeImportPhone } from "../src/modules/contacts/contacts.service";
import { resetDatabase, createTestConnection, createTestUser, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

describe("Contatos e etiquetas", () => {
  let connectionId: string;
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.tag.deleteMany();
    connectionId = (await createTestConnection("Suporte")).id;
    await createTestUser({ email: "admin@test.dev", role: "ADMIN" });
    token = await loginAs("admin@test.dev");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("importa CSV (cria, atualiza e aponta linhas com erro), busca e exporta", async () => {
    await prisma.contact.create({ data: { phone: "5511900000001", name: null, whatsappConnectionId: connectionId } });
    const csv = ["Nome;Telefone;Etiquetas", "Ana Souza;(11) 90000-0001;VIP, Atacado", "Bruno;11 90000-0002;vip", "Sem número;abc;"].join("\n");

    const imported = await request(app).post("/api/contacts/import").set("Authorization", `Bearer ${token}`).send({ whatsappConnectionId: connectionId, csv });
    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({ created: 1, updated: 1, errors: [{ line: 4, reason: 'Telefone inválido: "abc"' }] });
    expect(await prisma.tag.count()).toBe(2); // "VIP" and "vip" are one tag

    const search = await request(app).get("/api/contacts").query({ search: "ana" }).set("Authorization", `Bearer ${token}`);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0]).toMatchObject({ name: "Ana Souza", phone: "5511900000001", connectionName: "Suporte" });
    expect(search.body.items[0].tags.map((t: { name: string }) => t.name)).toEqual(["VIP", "Atacado"]);

    const vip = await prisma.tag.findFirstOrThrow({ where: { name: "VIP" } });
    const byTag = await request(app).get("/api/contacts").query({ tagId: vip.id }).set("Authorization", `Bearer ${token}`);
    expect(byTag.body.total).toBe(2);

    const exported = await request(app).get("/api/contacts/export").set("Authorization", `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("Ana Souza;5511900000001;Suporte;VIP, Atacado;0;");
  });

  it("edita nome e etiquetas; renomeia, muda cor e exclui etiqueta", async () => {
    const contact = await prisma.contact.create({ data: { phone: "5511900000003", whatsappConnectionId: connectionId } });
    const tag = await request(app).post("/api/contacts/tags").set("Authorization", `Bearer ${token}`).send({ name: "Cliente novo", color: "#DB2777" });
    expect(tag.status).toBe(201);

    const updated = await request(app).patch(`/api/contacts/${contact.id}`).set("Authorization", `Bearer ${token}`).send({ name: "Carla", tagIds: [tag.body.id] });
    expect(updated.body).toMatchObject({ name: "Carla", tags: [{ name: "Cliente novo", color: "#DB2777" }], conversations: [] });

    const duplicate = await request(app).post("/api/contacts/tags").set("Authorization", `Bearer ${token}`).send({ name: "cliente NOVO", color: "#000000" });
    expect(duplicate.status).toBe(409);

    await request(app).patch(`/api/contacts/tags/${tag.body.id}`).set("Authorization", `Bearer ${token}`).send({ name: "Recorrente", color: "#059669" });
    const tags = await request(app).get("/api/contacts/tags").set("Authorization", `Bearer ${token}`);
    expect(tags.body).toEqual([{ id: tag.body.id, name: "Recorrente", color: "#059669", contactCount: 1 }]);

    expect((await request(app).delete(`/api/contacts/tags/${tag.body.id}`).set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect(await prisma.contactTag.count()).toBe(0);
  });

  it("um atendente não acessa Contatos por padrão", async () => {
    await createTestUser({ email: "agente@test.dev", role: "AGENT", whatsappConnectionId: connectionId });
    const agentToken = await loginAs("agente@test.dev");
    expect((await request(app).get("/api/contacts").set("Authorization", `Bearer ${agentToken}`)).status).toBe(403);
  });

  it("normaliza telefones com e sem DDI", () => {
    expect(normalizeImportPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeImportPhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizeImportPhone("1 23")).toBeNull();
  });
});
