CREATE TABLE "CouponResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "title" VARCHAR(180),
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" "MediaType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CouponResult_postId_key" ON "CouponResult"("postId");
CREATE INDEX "CouponResult_tenantId_createdAt_idx" ON "CouponResult"("tenantId", "createdAt");

ALTER TABLE "CouponResult" ADD CONSTRAINT "CouponResult_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CouponResult" ADD CONSTRAINT "CouponResult_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
