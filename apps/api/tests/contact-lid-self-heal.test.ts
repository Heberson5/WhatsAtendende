import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import * as conversationsService from "../src/modules/conversations/conversations.service";
import { resetDatabase, createTestConnection } from "./helpers";

describe("findOrCreateContact self-heals a contact whose phone was originally a WhatsApp @lid privacy id", () => {
  let connectionId: string;

  beforeEach(async () => {
    await resetDatabase();
    connectionId = (await createTestConnection("Suporte")).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("corrects the stored phone in place (same contact/history) once the real number becomes resolvable, instead of creating a duplicate", async () => {
    // First contact ever seen on this chat: WhatsApp only exposed the
    // opaque @lid digits at the time, so that's what got stored as "phone".
    const lidDigits = "188764014026962";
    const first = await conversationsService.findOrCreateContact(connectionId, lidDigits, "Karen", `${lidDigits}@lid`);
    expect(first.phone).toBe(lidDigits);

    const contactCountAfterFirst = await prisma.contact.count({ where: { whatsappConnectionId: connectionId } });
    expect(contactCountAfterFirst).toBe(1);

    // A later message on the SAME chat (same providerChatId) resolves the
    // real phone number (e.g. via senderPn) — must correct the existing
    // row, not spawn a second contact for the same person.
    const realPhone = "5511988887777";
    const healed = await conversationsService.findOrCreateContact(connectionId, realPhone, "Karen", `${lidDigits}@lid`);
    expect(healed.id).toBe(first.id);
    expect(healed.phone).toBe(realPhone);

    const contactCountAfterHeal = await prisma.contact.count({ where: { whatsappConnectionId: connectionId } });
    expect(contactCountAfterHeal).toBe(1);

    const byOldPhone = await prisma.contact.findUnique({
      where: { phone_whatsappConnectionId: { phone: lidDigits, whatsappConnectionId: connectionId } },
    });
    expect(byOldPhone).toBeNull();
  });

  it("still creates a normal new contact when there's nothing to heal (no providerChatId, or a genuinely new chat)", async () => {
    const contact = await conversationsService.findOrCreateContact(connectionId, "5511999998888", "Novo Cliente");
    expect(contact.phone).toBe("5511999998888");
    const count = await prisma.contact.count({ where: { whatsappConnectionId: connectionId } });
    expect(count).toBe(1);
  });
});
