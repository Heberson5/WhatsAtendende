import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import type { Role } from "@prisma/client";

export async function resetDatabase() {
  // Order matters: children before parents.
  await prisma.messageReaction.deleteMany();
  await prisma.messageAttachment.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversationEvent.deleteMany();
  await prisma.conversationTransfer.deleteMany();
  await prisma.conversationAssignment.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.whatsAppConnection.deleteMany();
}

export async function createTestConnection(name: string) {
  return prisma.whatsAppConnection.create({ data: { name } });
}

export async function createTestUser(input: {
  email: string;
  role: Role;
  displayName?: string;
  status?: "ACTIVE" | "INACTIVE";
  presence?: "ONLINE" | "AWAY" | "OFFLINE";
  whatsappConnectionId?: string;
}) {
  const passwordHash = await bcrypt.hash("Test@1234", 4);
  return prisma.user.create({
    data: {
      email: input.email,
      fullName: input.displayName ?? input.email,
      displayName: input.displayName ?? input.email,
      role: input.role,
      status: input.status ?? "ACTIVE",
      presence: input.presence ?? "OFFLINE",
      passwordHash,
      whatsappConnectionId: input.whatsappConnectionId,
    },
  });
}

export async function createWaitingConversation(phone: string, connectionId: string) {
  const contact = await prisma.contact.create({ data: { phone, name: `Cliente ${phone}`, whatsappConnectionId: connectionId } });
  const conversation = await prisma.conversation.create({
    data: { contactId: contact.id, whatsappConnectionId: connectionId, status: "WAITING", enteredQueueAt: new Date(), lastMessageAt: new Date() },
  });
  return { contact, conversation };
}

export const TEST_PASSWORD = "Test@1234";
