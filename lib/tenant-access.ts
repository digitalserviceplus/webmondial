import type { PostVisibility } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isEffectivelyPaid } from "@/lib/publications";

export async function canViewTenantPost({
  userId,
  role,
  tenantId,
  postId,
  visibility,
  price,
}: {
  userId?: string;
  role?: string;
  tenantId: string;
  postId: string;
  visibility: PostVisibility;
  price?: number | null;
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
  if (!isEffectivelyPaid(visibility, price)) {
    if (visibility === "PUBLIC" || visibility === "PAID") return true;
    if (visibility === "PRIVATE") return false;
    return Boolean(userId && membership);
  }
  if (visibility === "PUBLIC") return true;
  if (!userId) return false;
  if (visibility === "TENANT_PLAYERS") return Boolean(membership);
  if (visibility === "PAID") {
    return Boolean(
      await prisma.publicationPurchase.findFirst({
        where: { postId, userId, payment: { is: { status: "SUCCEEDED" } } },
        select: { id: true },
      }),
    );
  }
  return false;
}
