import assert from "node:assert/strict";
import test from "node:test";
import { bookmakerSchema, initialAdminSchema, loginSchema, registrationSchema, strongPasswordSchema } from "../lib/validation";

test("player registration accepts an email and a URL-safe tenant handle", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    email: "AMIRA@example.com",
    phone: "",
    country: "Benin",
    password: "A-long-password-123",
    tenantHandle: "xpro-demo",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.email, "AMIRA@example.com");
    assert.equal(result.data.phone, undefined);
  }
});

test("player registration requires at least one unique contact identifier", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    email: "",
    phone: "",
    country: "Benin",
    password: "A-long-password-123",
    tenantHandle: "xpro-demo",
  });

  assert.equal(result.success, false);
});

test("player phone numbers must use international notation", () => {
  const result = registrationSchema.safeParse({
    name: "Amira Diallo",
    phone: "0022912345678",
    country: "Benin",
    password: "A-long-password-123",
    tenantHandle: "xpro-demo",
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

test("login accepts an email or international phone identifier", () => {
  assert.equal(loginSchema.safeParse({ identifier: "owner@example.com", password: "secret" }).success, true);
  assert.equal(loginSchema.safeParse({ identifier: "+22912345678", password: "secret" }).success, true);
});
