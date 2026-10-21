ALTER TABLE "Post"
  ALTER COLUMN "price" TYPE DECIMAL(12, 2)
  USING "price"::DECIMAL(12, 2);

ALTER TABLE "Payment"
  ALTER COLUMN "amount" TYPE DECIMAL(12, 2)
  USING "amount"::DECIMAL(12, 2);

ALTER TABLE "Payment"
  ADD COLUMN "providerTransactionId" TEXT,
  ADD COLUMN "providerAmount" DECIMAL(12, 2),
  ADD COLUMN "providerCurrency" VARCHAR(3);

CREATE UNIQUE INDEX "Payment_providerTransactionId_key"
  ON "Payment"("providerTransactionId");
