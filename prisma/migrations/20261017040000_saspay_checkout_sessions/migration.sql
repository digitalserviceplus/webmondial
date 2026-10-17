ALTER TABLE "Payment"
ADD COLUMN "providerPaymentId" TEXT,
ADD COLUMN "checkoutUrl" TEXT;

CREATE UNIQUE INDEX "Payment_providerPaymentId_key"
ON "Payment"("providerPaymentId");
