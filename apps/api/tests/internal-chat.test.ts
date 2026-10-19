import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestUser, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

describe("Chat interno", () => {
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${token[who]}` });

  beforeAll(async () => {
    await resetDatabase();
    await prisma.chatRoom.deleteMany();
    for (const [who, role] of [["ana", "AGENT"], ["bia", "AGENT"], ["caio", "AGENT"], ["duda", "AGENT"], ["gestor", "MANAGER"]] as const) {
      id[who] = (await createTestUser({ email: `${who}-chat@test.dev`, role, displayName: who })).id;
      token[who] = await loginAs(`${who}-chat@test.dev`);
    }
  });

  afterAll(async () => {
    await prisma.chatRoom.deleteMany();
    await prisma.$disconnect();
  });

  it("todo mundo está no #Geral, e a conversa direta fica com ✓✓ quando o outro lê", async () => {
    const rooms = (await request(app).get("/api/internal-chat/rooms").set(as("ana"))).body;
    expect(rooms[0]).toMatchObject({ kind: "GENERAL", name: "#Geral", canLeave: false });

    const dm = (await request(app).post("/api/internal-chat/direct").set(as("ana")).send({ userId: id.bia })).body;
    expect(dm).toMatchObject({ kind: "DIRECT", name: "bia" });
    const again = (await request(app).post("/api/internal-chat/direct").set(as("bia")).send({ userId: id.ana })).body;
    expect(again.id).toBe(dm.id);

    const sent = (await request(app).post(`/api/internal-chat/rooms/${dm.id}/messages`).set(as("ana")).send({ body: "Oi, Bia" })).body;
    expect(sent.readByAll).toBe(false);
    const biaRooms = (await request(app).get("/api/internal-chat/rooms").set(as("bia"))).body;
    expect(biaRooms.find((r: { id: string }) => r.id === dm.id).unreadCount).toBe(1);
    await request(app).post(`/api/internal-chat/rooms/${dm.id}/read`).set(as("bia")).expect(204);
    const messages = (await request(app).get(`/api/internal-chat/rooms/${dm.id}/messages`).set(as("ana"))).body;
    expect(messages.at(-1).readByAll).toBe(true);
  });

  it("grupo: só dono e administradores adicionam; só o dono escolhe administradores; histórico é opcional", async () => {
    const group = (await request(app).post("/api/internal-chat/groups").set(as("ana")).send({ name: "Cobrança", memberIds: [id.bia] })).body;
    expect(group).toMatchObject({ canManageMembers: true, canManageAdmins: true });
    await request(app).post(`/api/internal-chat/rooms/${group.id}/messages`).set(as("ana")).send({ body: "mensagem antiga" }).expect(201);

    expect((await request(app).post(`/api/internal-chat/rooms/${group.id}/members`).set(as("bia")).send({ userIds: [id.caio], canSeeHistory: true })).status).toBe(403);
    expect((await request(app).put(`/api/internal-chat/rooms/${group.id}/members/${id.bia}/admin`).set(as("bia")).send({ admin: true })).status).toBe(403);
    await request(app).put(`/api/internal-chat/rooms/${group.id}/members/${id.bia}/admin`).set(as("ana")).send({ admin: true }).expect(200);

    await request(app).post(`/api/internal-chat/rooms/${group.id}/members`).set(as("bia")).send({ userIds: [id.caio], canSeeHistory: false }).expect(200);
    await request(app).post(`/api/internal-chat/rooms/${group.id}/members`).set(as("bia")).send({ userIds: [id.duda], canSeeHistory: true }).expect(200);
    const caioSees = (await request(app).get(`/api/internal-chat/rooms/${group.id}/messages`).set(as("caio"))).body.map((m: { body: string }) => m.body);
    const dudaSees = (await request(app).get(`/api/internal-chat/rooms/${group.id}/messages`).set(as("duda"))).body.map((m: { body: string }) => m.body);
    expect(caioSees).not.toContain("mensagem antiga");
    expect(dudaSees).toContain("mensagem antiga");
  });

  it("quem sai deixa de ver o grupo; o dono que sai passa o grupo ao administrador mais antigo", async () => {
    const group = (await request(app).get("/api/internal-chat/rooms").set(as("ana"))).body.find((r: { name: string }) => r.name === "Cobrança");
    await request(app).post(`/api/internal-chat/rooms/${group.id}/leave`).set(as("ana")).expect(204);
    expect((await request(app).get("/api/internal-chat/rooms").set(as("ana"))).body.some((r: { id: string }) => r.id === group.id)).toBe(false);
    const forBia = (await request(app).get("/api/internal-chat/rooms").set(as("bia"))).body.find((r: { id: string }) => r.id === group.id);
    expect(forBia.canManageAdmins).toBe(true);
    const lines = (await request(app).get(`/api/internal-chat/rooms/${group.id}/messages`).set(as("bia"))).body.map((m: { body: string }) => m.body);
    expect(lines).toContain("ana saiu do grupo");
    expect((await request(app).get(`/api/internal-chat/rooms/${group.id}/messages`).set(as("ana"))).status).toBe(404);
  });

  it("gestão lê tudo sem marcar como lido, e cada leitura vai para a auditoria", async () => {
    expect((await request(app).get("/api/internal-chat/oversight/rooms").set(as("ana"))).status).toBe(403);
    const rooms = (await request(app).get("/api/internal-chat/oversight/rooms").set(as("gestor"))).body;
    const dm = rooms.find((r: { kind: string }) => r.kind === "DIRECT");
    expect(dm.name).toContain("↔");
    const before = await prisma.chatMember.findMany({ where: { roomId: dm.id } });
    await request(app).get(`/api/internal-chat/oversight/rooms/${dm.id}/messages`).set(as("gestor")).expect(200);
    expect(await prisma.chatMember.findMany({ where: { roomId: dm.id } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: "INTERNAL_CHAT_OVERSIGHT_READ", entityId: dm.id } })).toBe(1);
  });
});
