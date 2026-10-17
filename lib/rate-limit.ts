import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function rateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "RateLimitCounter" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE
        WHEN "RateLimitCounter"."resetAt" <= ${now} THEN 1
        ELSE "RateLimitCounter"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitCounter"."resetAt" <= ${now} THEN ${resetAt}
        ELSE "RateLimitCounter"."resetAt"
      END,
      "updatedAt" = ${now}
    WHERE "RateLimitCounter"."resetAt" <= ${now}
       OR "RateLimitCounter"."count" < ${limit}
    RETURNING "count"
  `);
  return rows.length > 0;
}

export function requestKey(request: Request, scope: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${address}`.slice(0, 190);
}
