import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDatabase, createTestUser, TEST_PASSWORD } from "./helpers";

const app = createApp();
const HOUR = 60 * 60 * 1000;

describe("dashboard: team now and presence durations", () => {
  let token: string;

  beforeEach(async () => {
    await resetDatabase();
    await createTestUser({ email: "admin@test.dev", role: "ADMIN", displayName: "Admin" });
    token = (await request(app).post("/api/auth/login").send({ email: "admin@test.dev", password: TEST_PASSWORD })).body.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts who is online/paused right now and sums each agent's online and paused time in the period", async () => {
    const reason = await prisma.pauseReason.create({ data: { name: "Almoço" } });
    const paula = await createTestUser({ email: "paula@test.dev", role: "AGENT", displayName: "Paula", presence: "AWAY" });
    await prisma.user.update({ where: { id: paula.id }, data: { pauseReasonId: reason.id } });
    const now = Date.now();
    await prisma.agentStatusLog.createMany({
      data: [
        { userId: paula.id, status: "ONLINE", startedAt: new Date(now - 3 * HOUR), endedAt: new Date(now - HOUR) },
        { userId: paula.id, status: "AWAY", pauseReasonId: reason.id, startedAt: new Date(now - HOUR), endedAt: null },
      ],
    });

    const res = await request(app)
      .get("/api/dashboard/team")
      .query({ period: "custom", from: new Date(now - 24 * HOUR).toISOString(), to: new Date(now + HOUR).toISOString() })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Admin just logged in (ONLINE); Paula is paused.
    expect(res.body.now).toMatchObject({ online: 1, paused: 1, offline: 0 });
    expect(res.body.now.pausedUsers[0]).toMatchObject({ name: "Paula", reasonName: "Almoço" });

    const row = res.body.agents.find((a: { agentName: string }) => a.agentName === "Paula");
    expect(row).toMatchObject({ presence: "AWAY", pauseReasonName: "Almoço" });
    expect(row.onlineMs).toBeCloseTo(2 * HOUR, -4);
    expect(row.pausedMs).toBeGreaterThanOrEqual(HOUR - 5_000);
  });

  it("returns the previous period's headline numbers for comparison", async () => {
    const res = await request(app).get("/api/dashboard").query({ period: "today" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.previous).toEqual({ received: 0, unique: 0, closed: 0, messagesTotal: 0, avgFirstResponseMs: null });
  });
});
