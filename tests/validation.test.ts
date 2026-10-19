import assert from "node:assert/strict";
import test from "node:test";
import { bookmakerSchema, emailVerificationSchema, initialAdminSchema, loginSchema, passwordResetSchema, registrationSchema, strongPasswordSchema } from "../lib/validation";
import { createEmailVerificationCode, hashEmailVerificationCode, matchesEmailVerificationCode } from "../lib/email-verification";

test("player registration requires an email and accepts a URL-safe tenant handle", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    email: "AMIRA@example.com",
    country: "Benin",
    password: "A-long-password-123",
    tenantHandle: "xpro-demo",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.email, "amira@example.com");
  }
});

test("player registration rejects a missing or invalid email", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    email: "",
    country: "Benin",
    password: "A-long-password-123",
    tenantHandle: "xpro-demo",
  });

  assert.equal(result.success, false);
});

test("player registration cannot use a phone number instead of an email", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    phone: "+22912345678",
    country: "Benin",
    password: "A-long-password-123",
  });

  assert.equal(result.success, false);
});

test("the initial Super Admin password and setup token are required", () => {
  const result = initialAdminSchema.safeParse({
    name: "Site Owner",
    email: "owner@example.com",
    password: "short",
    setupToken: "",
  });

  assert.equal(result.success, false);
});

test("new passwords require uppercase, lowercase, and a number", () => {
  assert.equal(strongPasswordSchema.safeParse("A-long-password-123").success, true);
  assert.equal(strongPasswordSchema.safeParse("all-lowercase-123").success, false);
  assert.equal(strongPasswordSchema.safeParse("ALL-UPPERCASE-123").success, false);
  assert.equal(strongPasswordSchema.safeParse("No-number-password").success, false);
  assert.equal(strongPasswordSchema.safeParse("Short1A").success, false);
});

test("bookmaker form accepts checkbox values for active state", () => {
  const formValues = {
    name: "Example Bookmaker",
    promoCode: "SPORTS",
    signupUrl: "https://example.com/register",
    videoUrl: "",
    logoUrl: "",
    brandColor: "#5b9cff",
    active: "true",
  };
  assert.equal(bookmakerSchema.safeParse(formValues).success, true);
  const inactiveResult = bookmakerSchema.safeParse({ ...formValues, active: "false" });
  assert.equal(inactiveResult.success, true);
  if (inactiveResult.success) assert.equal(inactiveResult.data.active, false);
  assert.equal(bookmakerSchema.safeParse({ ...formValues, signupUrl: "javascript:alert(1)" }).success, false);
});

test("login accepts email only", () => {
  assert.equal(loginSchema.safeParse({ email: "owner@example.com", password: "secret" }).success, true);
  assert.equal(loginSchema.safeParse({ email: "+22912345678", password: "secret" }).success, false);
});

test("email verification accepts only an eight-digit code", () => {
  assert.equal(emailVerificationSchema.safeParse({ email: "OWNER@example.com", code: "12345678" }).success, true);
  assert.equal(emailVerificationSchema.safeParse({ email: "owner@example.com", code: "1234" }).success, false);
});

test("verification codes are random eight-digit values and use a keyed hash", () => {
  const code = createEmailVerificationCode();
  assert.match(code, /^\d{8}$/);
  const storedHash = hashEmailVerificationCode(code, "test-secret");
  assert.equal(matchesEmailVerificationCode(code, storedHash, "test-secret"), true);
  assert.equal(matchesEmailVerificationCode(code, storedHash, "different-secret"), false);
  assert.equal(matchesEmailVerificationCode("00000000", storedHash, "test-secret"), false);
});

test("password reset requires matching strong passwords", () => {
  const values = { token: "a".repeat(32), password: "A-long-password-123", confirmPassword: "A-long-password-123" };
  assert.equal(passwordResetSchema.safeParse(values).success, true);
  assert.equal(passwordResetSchema.safeParse({ ...values, confirmPassword: "different" }).success, false);
});
