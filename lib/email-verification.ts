import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const EMAIL_VERIFICATION_LIFETIME_MS = 15 * 60_000;
export const EMAIL_VERIFICATION_RESEND_DELAY_MS = 60_000;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

export function createEmailVerificationCode() {
  return randomInt(10_000_000, 100_000_000).toString();
}

export function hashEmailVerificationCode(code: string, secret: string) {
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function matchesEmailVerificationCode(code: string, expectedHash: string, secret: string) {
  const candidate = Buffer.from(hashEmailVerificationCode(code, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function hashRateLimitIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
