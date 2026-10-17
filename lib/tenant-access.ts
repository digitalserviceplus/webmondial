import type { PostVisibility } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function canViewTenantPost({
  userId,
  role,
  tenantId,
  postId,
  visibility,
}: {
  userId?: string;
  role?: string;
  tenantId: string;
  postId: string;
  visibility: PostVisibility;
}) {
  if (role === "SUPER_ADMIN") return true;

  const [tenant, membership] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerId: true, status: true },
    }),
    userId
      ? prisma.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
          select: { id: true },
        })
      : null,
  ]);
  if (!tenant || tenant.status !== "ACTIVE") return false;

  if (role === "ADMIN" && tenant.ownerId === userId) return true;
  if (visibility === "PUBLIC") return true;
  if (!userId || !membership) return false;
  if (visibility === "TENANT_PLAYERS") return true;
  if (visibility === "PAID") {
    return Boolean(
      await prisma.publicationPurchase.findUnique({
        where: { postId_userId: { postId, userId } },
        select: { id: true },
      }),
    );
  }
  return false;
}
