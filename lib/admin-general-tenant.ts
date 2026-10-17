import { prisma } from "@/lib/prisma";

function baseHandle(name: string) {
  const handle = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36)
    .replace(/-$/, "");
  return handle || "admin-general";
}

export async function ensureGeneralAdminTenant(userId: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });
    if (!user || user.role !== "SUPER_ADMIN") return null;

    const existing = await tx.tenant.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, handle: true, displayName: true, status: true },
    });
    if (existing) {
      if (existing.status === "PENDING") {
        await tx.tenant.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
        await tx.partnershipAgreement.updateMany({
          where: { tenantId: existing.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });
      }
      return { ...existing, status: existing.status === "PENDING" ? "ACTIVE" : existing.status };
    }

    const base = baseHandle(user.name);
    let handle = base;
    let suffix = 2;
    while (await tx.tenant.findUnique({ where: { handle }, select: { id: true } })) {
      const ending = `-${suffix++}`;
      handle = `${base.slice(0, 40 - ending.length)}${ending}`;
    }
    const tenant = await tx.tenant.create({
      data: {
        ownerId: user.id,
        handle,
        displayName: user.name,
        status: "ACTIVE",
      },
      select: { id: true, handle: true, displayName: true, status: true },
    });
    return tenant;
  });
}
