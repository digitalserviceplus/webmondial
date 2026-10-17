import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/site-url";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await headers();
  const siteUrl = getSiteUrl();
  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { handle: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return [
    { url: siteUrl.toString(), changeFrequency: "daily", priority: 1 },
    ...tenants.map((tenant) => ({
      url: new URL(tenant.handle, siteUrl).toString(),
      lastModified: tenant.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
