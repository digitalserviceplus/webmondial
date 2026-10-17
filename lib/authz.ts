import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

export async function requireRole(role: "SUPER_ADMIN" | "ADMIN" | "PLAYER") {
  const session = await requireSession();
  return session?.user.role === role ? session : null;
}

export async function getOwnedTenant(userId: string) {
  return prisma.tenant.findFirst({
    where: { ownerId: userId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      status: true,
      suspensionReason: true,
    },
  });
}

export async function getTenantMembership(userId: string, tenantId: string) {
  return prisma.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { id: true },
  });
}
