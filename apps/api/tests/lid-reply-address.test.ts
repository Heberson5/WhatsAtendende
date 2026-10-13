import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { __getProviderForTests, sendOutboundText, sendReaction } from "../src/modules/whatsapp/whatsapp.service";
import type { MockWhatsAppProvider } from "@whatsatendende/whatsapp";
import { resetDatabase, createTestUser, TEST_PASSWORD } from "./helpers";

const app = createApp();

/**
 * A customer whose WhatsApp never revealed their number writes from a hidden id (…@lid); the contact keeps
 * those digits where the phone goes. The answer must go back to that @lid — built as a phone number, it
 * pointed at someone else and the customer never got it.
 */
describe("resposta para cliente com identificador oculto (LID)", () => {
  let connectionId: string;
  let provider: MockWhatsAppProvider;

  beforeAll(async () => {
    await resetDatabase();
    await createTestUser({ email: "admin-lid@test.dev", role: "ADMIN" });
    const token = (await request(app).post("/api/auth/login").send({ email: "admin-lid@test.dev", password: TEST_PASSWORD })).body.accessToken as string;
    const created = await request(app).post("/api/whatsapp/connections").set("Authorization", `Bearer ${token}`).send({ name: "SuporteLid" });
    connectionId = created.body.id;
    await request(app).post(`/api/whatsapp/connections/${connectionId}/connect`).set("Authorization", `Bearer ${token}`);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    provider = __getProviderForTests(connectionId) as MockWhatsAppProvider;
  }, 20000);

  afterAll(async () => prisma.$disconnect());

  async function outboundTo(phone: string, providerChatId: string | null) {
    const contact = await prisma.contact.create({ data: { phone, providerChatId, whatsappConnectionId: connectionId } });
    const conversation = await prisma.conversation.create({ data: { contactId: contact.id, whatsappConnectionId: connectionId, status: "IN_PROGRESS" } });
    return prisma.message.create({ data: { conversationId: conversation.id, direction: "OUTBOUND", type: "TEXT", status: "PENDING", body: "oi" } });
  }

  it("cliente que só tem o LID recebe no próprio LID", async () => {
    const message = await outboundTo("201234567890123", "201234567890123@lid");
    await sendOutboundText(connectionId, message.id, "201234567890123", "Olá!", "Ana");
    expect(provider.sentTexts.at(-1)?.chatId).toBe("201234567890123@lid");

    await sendReaction(connectionId, "201234567890123", "ABC", "👍");
    expect(provider.reactionsSent.at(-1)?.chatId).toBe("201234567890123@lid");
  });

  it("cliente com número conhecido continua recebendo no número", async () => {
    const message = await outboundTo("5565988887777", "998877665544332@lid");
    await sendOutboundText(connectionId, message.id, "5565988887777", "Olá!", "Ana");
    expect(provider.sentTexts.at(-1)?.chatId).toBe("5565988887777@s.whatsapp.net");

    const plain = await outboundTo("5565911112222", null);
    await sendOutboundText(connectionId, plain.id, "5565911112222", "Olá!", "Ana");
    expect(provider.sentTexts.at(-1)?.chatId).toBe("5565911112222@s.whatsapp.net");
  });
});
