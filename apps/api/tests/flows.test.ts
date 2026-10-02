import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestUser, createTestConnection, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

async function createOfficialConnection(name: string) {
  return prisma.whatsAppConnection.create({ data: { name, connectionMode: "OFFICIAL_API", status: "CONNECTED" } });
}

describe("Fluxo — see PROMPT: \"um novo menu chamado Fluxo... função de ativar e desativar... atendentes designados no nó\"", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createTestUser({ email: "admin@test.dev", role: "ADMIN" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a flow with a single START node, inactive by default, linked to an official connection", async () => {
    const token = await loginAs("admin@test.dev");
    const oficial = await createOfficialConnection("Vendas Oficial");

    const res = await request(app)
      .post("/api/flows")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Boas-vindas", description: "Fluxo de recepção", connectionIds: [oficial.id] });

    expect(res.status).toBe(201);
    expect(res.body.active).toBe(false);
    expect(res.body.connectionIds).toEqual([oficial.id]);
    expect(res.body.nodeCount).toBe(1);

    const detail = await request(app).get(`/api/flows/${res.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.nodes).toHaveLength(1);
    expect(detail.body.nodes[0].type).toBe("START");
  });

  it("refuses to link a flow to a QRCODE connection", async () => {
    const token = await loginAs("admin@test.dev");
    const qr = await createTestConnection("Suporte QR");

    const res = await request(app).post("/api/flows").set("Authorization", `Bearer ${token}`).send({ name: "Teste", connectionIds: [qr.id] });
    expect(res.status).toBe(400);
  });

  it("activates and deactivates a flow", async () => {
    const token = await loginAs("admin@test.dev");
    const create = await request(app).post("/api/flows").set("Authorization", `Bearer ${token}`).send({ name: "Fluxo A" });
    expect(create.body.active).toBe(false);

    const activate = await request(app).patch(`/api/flows/${create.body.id}`).set("Authorization", `Bearer ${token}`).send({ active: true });
    expect(activate.status).toBe(200);
    expect(activate.body.active).toBe(true);

    const deactivate = await request(app).patch(`/api/flows/${create.body.id}`).set("Authorization", `Bearer ${token}`).send({ active: false });
    expect(deactivate.body.active).toBe(false);
  });

  it("saves a graph with a TRANSFER_TO_AGENT node carrying the assigned agent ids", async () => {
    const token = await loginAs("admin@test.dev");
    const joao = await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const create = await request(app).post("/api/flows").set("Authorization", `Bearer ${token}`).send({ name: "Fluxo B" });
    const flowId = create.body.id;
    const detail = await request(app).get(`/api/flows/${flowId}`).set("Authorization", `Bearer ${token}`);
    const startNodeId = detail.body.nodes[0].id;

    const res = await request(app)
      .put(`/api/flows/${flowId}/graph`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        nodes: [
          { id: startNodeId, type: "START", positionX: 0, positionY: 0, data: {} },
          { id: "tmp-transfer", type: "TRANSFER_TO_AGENT", positionX: 200, positionY: 0, data: { assignedAgentIds: [joao.id] } },
        ],
        edges: [{ sourceNodeId: startNodeId, targetNodeId: "tmp-transfer" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    const transferNode = res.body.nodes.find((n: { type: string }) => n.type === "TRANSFER_TO_AGENT");
    expect(transferNode.data.assignedAgentIds).toEqual([joao.id]);
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0].targetNodeId).toBe(transferNode.id);
  });

  it("rejects a graph with no START node", async () => {
    const token = await loginAs("admin@test.dev");
    const create = await request(app).post("/api/flows").set("Authorization", `Bearer ${token}`).send({ name: "Fluxo C" });

    const res = await request(app)
      .put(`/api/flows/${create.body.id}/graph`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nodes: [{ id: "a", type: "END", positionX: 0, positionY: 0 }], edges: [] });
    expect(res.status).toBe(400);
  });

  it("deletes a flow and cascades its nodes/edges/connections", async () => {
    const token = await loginAs("admin@test.dev");
    const oficial = await createOfficialConnection("Suporte Oficial");
    const create = await request(app)
      .post("/api/flows")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Fluxo D", connectionIds: [oficial.id] });

    const del = await request(app).delete(`/api/flows/${create.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const nodes = await prisma.flowNode.findMany({ where: { flowId: create.body.id } });
    const connections = await prisma.flowConnection.findMany({ where: { flowId: create.body.id } });
    expect(nodes).toHaveLength(0);
    expect(connections).toHaveLength(0);
  });

  it("lists flows with connection names and node counts", async () => {
    const token = await loginAs("admin@test.dev");
    const oficial = await createOfficialConnection("Vendas Oficial 2");
    await request(app).post("/api/flows").set("Authorization", `Bearer ${token}`).send({ name: "Fluxo E", connectionIds: [oficial.id] });

    const res = await request(app).get("/api/flows").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].connectionNames).toEqual(["Vendas Oficial 2"]);
    expect(res.body[0].nodeCount).toBe(1);
  });
});
