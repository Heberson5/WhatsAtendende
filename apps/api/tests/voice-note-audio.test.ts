import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { __getProviderForTests } from "../src/modules/whatsapp/whatsapp.service";
import type { MockWhatsAppProvider } from "@whatsatendende/whatsapp";
import { resetDatabase, createTestUser, createWaitingConversation, TEST_PASSWORD } from "./helpers";
import { env } from "../src/config/env";

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  return res.body.accessToken as string;
}

function makeSampleWebmOpus(): Buffer {
  return execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libopus",
    "-f",
    "webm",
    "pipe:1",
  ]);
}

describe("a recorded voice note sends as WhatsApp's native PTT audio, not a generic file", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("transcodes the browser recording to OGG/Opus, stores it, and calls provider.sendAudio (not sendFile)", async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-audio@test.dev", role: "ADMIN" });
    const adminToken = await loginAs("admin-audio@test.dev");
    const created = await request(app)
      .post("/api/whatsapp/connections")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "SuporteAudio" });
    await request(app).post(`/api/whatsapp/connections/${created.body.id}/connect`).set("Authorization", `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 2200)); // mock provider: QR -> CONNECTED takes ~1.9s

    await createTestUser({
      email: "joao-audio@test.dev",
      role: "AGENT",
      displayName: "Joao Audio",
      whatsappConnectionId: created.body.id,
    });
    const joaoToken = await loginAs("joao-audio@test.dev");

    const { conversation } = await createWaitingConversation("5511990009999", created.body.id);
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    const webm = makeSampleWebmOpus();
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}/audio`)
      .set("Authorization", `Bearer ${joaoToken}`)
      .attach("file", webm, { filename: "audio-123.webm", contentType: "audio/webm" });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("AUDIO");
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].mimeType).toBe("audio/ogg");

    // The stored attachment on disk must be the *transcoded* OGG, not the
    // raw WebM upload passed straight through.
    const attachment = await prisma.messageAttachment.findUniqueOrThrow({ where: { id: res.body.attachments[0].id } });
    const onDisk = fs.readFileSync(path.join(env.UPLOAD_DIR, attachment.storageKey));
    expect(onDisk.subarray(0, 4).toString("ascii")).toBe("OggS");

    const provider = __getProviderForTests(created.body.id) as MockWhatsAppProvider;
    expect(provider.sentAudios).toHaveLength(1);
    expect(provider.sentAudios[0].mimeType).toContain("audio/ogg");
    expect(provider.sentFiles).toHaveLength(0); // never fell through to the generic document/file path
  }, 15000);

  it("um áudio continuado de um rascunho (vários trechos juntados em WAV no navegador) vai como nota de voz; WAV como anexo comum não", async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-wav@test.dev", role: "ADMIN" });
    const adminToken = await loginAs("admin-wav@test.dev");
    const created = await request(app).post("/api/whatsapp/connections").set("Authorization", `Bearer ${adminToken}`).send({ name: "SuporteWav" });
    await request(app).post(`/api/whatsapp/connections/${created.body.id}/connect`).set("Authorization", `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 2200)); // mock provider: QR -> CONNECTED takes ~1.9s
    await createTestUser({ email: "joao-wav@test.dev", role: "AGENT", displayName: "Joao Wav", whatsappConnectionId: created.body.id });
    const joaoToken = await loginAs("joao-wav@test.dev");
    const { conversation } = await createWaitingConversation("5511990009998", created.body.id);
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    // 1 s of silence, mono 16-bit 16 kHz — what lib/audio-merge produces.
    const samples = 16000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + samples * 2, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);

    const voice = await request(app)
      .post(`/api/messages/conversations/${conversation.id}/audio`)
      .set("Authorization", `Bearer ${joaoToken}`)
      .attach("file", wav, { filename: "audio-1.wav", contentType: "audio/wav" });
    expect(voice.status).toBe(201);
    expect(voice.body.attachments[0].mimeType).toBe("audio/ogg");

    const asFile = await request(app)
      .post(`/api/messages/conversations/${conversation.id}/file`)
      .set("Authorization", `Bearer ${joaoToken}`)
      .attach("file", wav, { filename: "gravacao.wav", contentType: "audio/wav" });
    expect(asFile.status).not.toBe(201);
  }, 15000);

  it("attaching a pre-existing audio file (not a live recording) still sends as playable audio, not a document", async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-audio2@test.dev", role: "ADMIN" });
    const adminToken = await loginAs("admin-audio2@test.dev");
    const created = await request(app)
      .post("/api/whatsapp/connections")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "SuporteAudio2" });
    await request(app).post(`/api/whatsapp/connections/${created.body.id}/connect`).set("Authorization", `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 2200));

    await createTestUser({
      email: "joao-audio2@test.dev",
      role: "AGENT",
      displayName: "Joao Audio2",
      whatsappConnectionId: created.body.id,
    });
    const joaoToken = await loginAs("joao-audio2@test.dev");
    const { conversation } = await createWaitingConversation("5511990008888", created.body.id);
    await request(app).post(`/api/conversations/${conversation.id}/accept`).set("Authorization", `Bearer ${joaoToken}`);

    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}/file`)
      .set("Authorization", `Bearer ${joaoToken}`)
      .attach("file", Buffer.from("fake-mp3-bytes"), { filename: "nota.mp3", contentType: "audio/mpeg" });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("AUDIO");
    // The generic /file route still goes through provider.sendFile (this
    // fixture isn't real audio, so it can't go through the transcoding
    // /audio route) — the fix under test is that BaileysWhatsAppProvider's
    // sendFile no longer falls through to a generic `document` payload for
    // audio/* mimetypes (see BaileysWhatsAppProvider.ts); MockWhatsAppProvider
    // doesn't distinguish the payload shape, so this only confirms routing.
    const provider = __getProviderForTests(created.body.id) as MockWhatsAppProvider;
    expect(provider.sentFiles).toHaveLength(1);
  }, 15000);
});
