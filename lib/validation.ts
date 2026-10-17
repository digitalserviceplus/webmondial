import { z } from "zod";

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().email().optional(),
);

const optionalPhone = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Utilisez le format international, ex. +229XXXXXXXX.").optional(),
);

const httpUrl = z.string().url().max(2048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Utilisez une adresse HTTP ou HTTPS.",
);

export const strongPasswordPattern = "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{12,128}";
export const strongPasswordSchema = z.string().regex(
  new RegExp(`^${strongPasswordPattern}$`),
  "Utilisez au moins 12 caractères avec une majuscule, une minuscule et un chiffre.",
);

export const bookmakerSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  promoCode: z.string().trim().max(80).optional(),
  signupUrl: httpUrl,
  videoUrl: z.union([httpUrl, z.literal("")]).optional(),
  logoUrl: z.union([httpUrl, z.literal("")]).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  active: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(true),
  ),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Saisissez votre email ou téléphone."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});

export const registrationSchema = z
  .object({
    name: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères.").max(120),
    email: optionalEmail,
    phone: optionalPhone.optional(),
    country: z.string().trim().min(2).max(80),
    password: strongPasswordSchema,
    language: z.enum(["fr", "en", "es"]).optional(),
    tenantHandle: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.string().trim().toLowerCase().min(1).max(40).optional(),
    ),
  })
  .refine((values) => Boolean(values.email || values.phone), {
    message: "Saisissez un email ou un numéro de téléphone.",
    path: ["email"],
  });

export const initialAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: optionalPhone.optional(),
  password: strongPasswordSchema,
  language: z.enum(["fr", "en", "es"]).optional(),
  setupToken: z.string().min(1).max(512),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegistrationValues = z.infer<typeof registrationSchema>;
export type InitialAdminValues = z.infer<typeof initialAdminSchema>;
export type RegistrationInput = z.input<typeof registrationSchema>;
export type InitialAdminInput = z.input<typeof initialAdminSchema>;
