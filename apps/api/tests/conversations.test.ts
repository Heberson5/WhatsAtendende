import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestUser, createWaitingConversation, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

describe("conversation queue and acceptance", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("only lets one of two simultaneous accepts win (no double-assignment)", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    await createTestUser({ email: "maria@test.dev", role: "AGENT", displayName: "Maria" });
    const [joaoToken, mariaToken] = await Promise.all([loginAs("joao@test.dev"), loginAs("maria@test.dev")]);

    const { conversation } = await createWaitingConversation("5511999990000");

    const [joaoRes, mariaRes] = await Promise.all([
      request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`),
      request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${mariaToken}`),
    ]);

    const statuses = [joaoRes.status, mariaRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = joaoRes.status === 200 ? "joao@test.dev" : "maria@test.dev";
    const loser = winner === "joao@test.dev" ? mariaRes : joaoRes;
    expect(loser.body.message).toMatch(/ja foi assumida/i);

    const persisted = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id }, include: { assignedAgent: true } });
    expect(persisted.status).toBe("IN_PROGRESS");
    expect(persisted.assignedAgent?.email).toBe(winner);

    // Exactly one ACCEPTED assignment record should exist — no duplicate wins.
    const assignments = await prisma.conversationAssignment.findMany({ where: { conversationId: conversation.id, reason: "ACCEPT" } });
    expect(assignments).toHaveLength(1);
  });

  it("hides message preview and content from the queue before acceptance", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const token = await loginAs("joao@test.dev");
    const { conversation, contact } = await createWaitingConversation("5511999991111");
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "INBOUND", type: "TEXT", status: "DELIVERED", body: "informação confidencial do cliente" },
    });

    const res = await request(app).get("/api/conversations/queue").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.find((c: { id: string }) => c.id === conversation.id);
    expect(item).toBeTruthy();
    expect(item.lastMessagePreview).toBeNull();
    expect(JSON.stringify(item)).not.toMatch(/confidencial/);
    expect(item.contact.phone).toBe(contact.phone);
  });

  it("blocks a second agent from opening a conversation already assigned to someone else", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    await createTestUser({ email: "maria@test.dev", role: "AGENT", displayName: "Maria" });
    const joaoToken = await loginAs("joao@test.dev");
    const mariaToken = await loginAs("maria@test.dev");
    const { conversation } = await createWaitingConversation("5511999992222");

    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    const res = await request(app).get(`/api/conversations/${conversation.id}`).set("Authorization", `Bearer ${mariaToken}`);
    expect(res.status).toBe(403);
  });

  it("transfers a conversation: it disappears from the old agent and appears for the new one", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const maria = await createTestUser({ email: "maria@test.dev", role: "AGENT", displayName: "Maria" });
    const joaoToken = await loginAs("joao@test.dev");
    const { conversation } = await createWaitingConversation("5511999993333");
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    const transferRes = await request(app)
      .post(`/api/conversations/${conversation.id}/transfer`)
      .set("Authorization", `Bearer ${joaoToken}`)
      .send({ toAgentId: maria.id, note: "cliente pediu especialista" });
    expect(transferRes.status).toBe(200);
    expect(transferRes.body.status).toBe("TRANSFERRED");
    expect(transferRes.body.assignedAgentId).toBe(maria.id);

    const mineJoao = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${joaoToken}`);
    expect(mineJoao.body.find((c: { id: string }) => c.id === conversation.id)).toBeUndefined();

    const mariaToken = await loginAs("maria@test.dev");
    const mineMaria = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${mariaToken}`);
    const transferred = mineMaria.body.find((c: { id: string }) => c.id === conversation.id);
    expect(transferred).toBeTruthy();
    expect(transferred.transfer.fromAgentName).toBe("Joao");
  });

  it("closes a conversation and removes it from the agent's active list", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const token = await loginAs("joao@test.dev");
    const { conversation } = await createWaitingConversation("5511999994444");
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${token}`);

    const closeRes = await request(app).post(`/api/conversations/${conversation.id}/close`).set("Authorization", `Bearer ${token}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");

    const mine = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${token}`);
    expect(mine.body.find((c: { id: string }) => c.id === conversation.id)).toBeUndefined();
  });

  it("lets a MANAGER view (but never mutate) any conversation via oversight", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    await createTestUser({ email: "gestor@test.dev", role: "MANAGER" });
    const joaoToken = await loginAs("joao@test.dev");
    const gestorToken = await loginAs("gestor@test.dev");
    const { conversation } = await createWaitingConversation("5511999995555");
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    const viewRes = await request(app).get(`/api/conversations/${conversation.id}`).set("Authorization", `Bearer ${gestorToken}`);
    expect(viewRes.status).toBe(200);

    const acceptAttempt = await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${gestorToken}`);
    expect(acceptAttempt.status).toBe(403);
  });

  it("shows an unread badge for new inbound messages and clears it once the agent marks it read", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const token = await loginAs("joao@test.dev");
    const { conversation } = await createWaitingConversation("5511999996666");
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${token}`);

    // Two more inbound messages arrive after acceptance (simulating provider events directly at the DB level).
    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, direction: "INBOUND", type: "TEXT", status: "DELIVERED", body: "oi" },
        { conversationId: conversation.id, direction: "INBOUND", type: "TEXT", status: "DELIVERED", body: "tudo bem?" },
      ],
    });

    const before = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${token}`);
    const item = before.body.find((c: { id: string }) => c.id === conversation.id);
    expect(item.unreadCount).toBe(2);

    const readRes = await request(app).post(`/api/conversations/${conversation.id}/read`).set("Authorization", `Bearer ${token}`);
    expect(readRes.status).toBe(204);

    const after = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${token}`);
    expect(after.body.find((c: { id: string }) => c.id === conversation.id).unreadCount).toBe(0);
  });

  it("resets the unread marker on transfer so the new agent sees the full history as unread", async () => {
    await createTestUser({ email: "joao@test.dev", role: "AGENT", displayName: "Joao" });
    const maria = await createTestUser({ email: "maria@test.dev", role: "AGENT", displayName: "Maria" });
    const joaoToken = await loginAs("joao@test.dev");
    const { conversation } = await createWaitingConversation("5511999997777");
    await prisma.message.create({
      data: { conversationId: conversation.id, direction: "INBOUND", type: "TEXT", status: "DELIVERED", body: "oi" },
    });
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);
    await request(app).post(`/api/conversations/${conversation.id}/read`).set("Authorization", `Bearer ${joaoToken}`);
    await request(app).post(`/api/conversations/${conversation.id}/transfer`).set("Authorization", `Bearer ${joaoToken}`).send({ toAgentId: maria.id });

    const mariaToken = await loginAs("maria@test.dev");
    const mine = await request(app).get("/api/conversations/mine").set("Authorization", `Bearer ${mariaToken}`);
    expect(mine.body.find((c: { id: string }) => c.id === conversation.id).unreadCount).toBeGreaterThan(0);
  });
});
