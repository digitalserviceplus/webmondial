import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be configured before running the seed.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.info("Seed skipped: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the local demo space.");
    return;
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must contain at least 12 characters.");
  }

  const handle = (process.env.SEED_TENANT_HANDLE ?? "xpro-demo").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(handle)) {
    throw new Error("SEED_TENANT_HANDLE must be a URL-safe handle (lowercase letters, numbers, and hyphens).");
  }

  const passwordHash = await hash(password, 12);
  const displayName = process.env.SEED_ADMIN_NAME?.trim() || "XPro Demo";
  await prisma.$transaction(async (tx) => {
    const existingAdmin = await tx.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (existingAdmin && existingAdmin.role !== "ADMIN") {
      throw new Error("The seed email already belongs to a non-admin account; refusing to change its role.");
    }

    const admin = existingAdmin
      ? await tx.user.update({
          where: { id: existingAdmin.id },
          data: { name: displayName, passwordHash },
          select: { id: true },
        })
      : await tx.user.create({
          data: { email, name: displayName, passwordHash, role: "ADMIN" },
          select: { id: true },
        });

    const existingTenant = await tx.tenant.findUnique({
      where: { handle },
      select: { ownerId: true },
    });
    if (existingTenant && existingTenant.ownerId !== admin.id) {
      throw new Error("The seed handle already belongs to another account; refusing to overwrite the space.");
    }

    if (existingTenant) {
      await tx.tenant.update({
        where: { handle },
        data: { displayName, status: "ACTIVE" },
      });
    } else {
      await tx.tenant.create({
        data: {
          ownerId: admin.id,
          handle,
          displayName,
          bio: "Espace de démonstration Web Mondial. Personnalisez cette présentation depuis votre compte.",
        },
      });
    }
  });

  console.info(`Demo space ready: /${handle} (login: ${email})`);
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
