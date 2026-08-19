import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(input: {
  email: string;
  fullName: string;
  displayName: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  password: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      fullName: input.fullName,
      displayName: input.displayName,
      role: input.role,
      passwordHash,
      status: "ACTIVE",
    },
  });
}

async function main() {
  console.log("Seeding development users (DEV ONLY — change all passwords before production)...");

  await upsertUser({
    email: "admin@whatsatendende.dev",
    fullName: "Administrador do Sistema",
    displayName: "Admin",
    role: "ADMIN",
    password: "Admin@123",
  });

  await upsertUser({
    email: "gestor@whatsatendende.dev",
    fullName: "Gestora de Atendimento",
    displayName: "Gestora",
    role: "MANAGER",
    password: "Gestor@123",
  });

  await upsertUser({
    email: "joao@whatsatendende.dev",
    fullName: "Joao Pereira",
    displayName: "Joao",
    role: "AGENT",
    password: "Agente@123",
  });

  await upsertUser({
    email: "maria@whatsatendende.dev",
    fullName: "Maria Fernandes",
    displayName: "Maria",
    role: "AGENT",
    password: "Agente@123",
  });

  console.log("Seed completed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
