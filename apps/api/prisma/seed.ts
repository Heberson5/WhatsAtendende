import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertConnection(name: string) {
  return prisma.whatsAppConnection.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}

async function upsertUser(input: {
  email: string;
  fullName: string;
  displayName: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  password: string;
  whatsappConnectionId?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { whatsappConnectionId: input.whatsappConnectionId },
    create: {
      email: input.email,
      fullName: input.fullName,
      displayName: input.displayName,
      role: input.role,
      passwordHash,
      status: "ACTIVE",
      whatsappConnectionId: input.whatsappConnectionId,
    },
  });
}

async function main() {
  console.log("Seeding development connections and users (DEV ONLY — change all passwords before production)...");

  // Two named connections so the multi-WhatsApp scenario is demonstrable
  // out of the box: each agent below is a home to exactly one, but can
  // still receive a transferred conversation from the other.
  const suporte = await upsertConnection("Suporte");
  const vendas = await upsertConnection("Vendas");

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
    whatsappConnectionId: suporte.id,
  });

  await upsertUser({
    email: "maria@whatsatendende.dev",
    fullName: "Maria Fernandes",
    displayName: "Maria",
    role: "AGENT",
    password: "Agente@123",
    whatsappConnectionId: vendas.id,
  });

  // A real admin account, provisioned only from environment variables so
  // its credentials never end up committed to the repo or printed in
  // documentation — pass SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (and
  // optionally SEED_ADMIN_NAME) when running this script. By default this
  // never touches an existing row's passwordHash (same as upsertUser
  // above), so re-running the seed can't silently reset a password that
  // was already changed through the app — but if you genuinely need to
  // reset a forgotten/mismatched password (e.g. bootstrapping the very
  // first login on a fresh deploy), also pass SEED_ADMIN_FORCE_RESET=true
  // to explicitly overwrite it.
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    const email = process.env.SEED_ADMIN_EMAIL;
    const name = process.env.SEED_ADMIN_NAME ?? "Administrador";
    const forceReset = process.env.SEED_ADMIN_FORCE_RESET === "true";
    const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12);
    await prisma.user.upsert({
      where: { email },
      update: forceReset ? { passwordHash, role: "ADMIN", status: "ACTIVE" } : {},
      create: { email, fullName: name, displayName: name, role: "ADMIN", passwordHash, status: "ACTIVE" },
    });
    console.log(`Admin provisionado a partir de variaveis de ambiente: ${email}${forceReset ? " (senha redefinida)" : ""}`);
  }

  console.log("Seed completed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
