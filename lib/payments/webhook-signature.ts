import { createHmac, timingSafeEqual } from "node:crypto";

const allowedClockSkewSeconds = 300;

export function isValidSasPayWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature) || !timestamp || !/^\d+$/.test(timestamp) || !secret) {
    return false;
  }
  const seconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > allowedClockSkewSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
