import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import type { UserRole } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { hashRateLimitIdentifier } from "@/lib/email-verification";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1),
});

function isUserRole(value: unknown): value is UserRole {
  return value === "SUPER_ADMIN" || value === "ADMIN" || value === "PLAYER";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: {
    signIn: "/connexion",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        if (!(await rateLimit(`login:${forwardedFor}:${hashRateLimitIdentifier(email)}`.slice(0, 190), 10, 15 * 60_000))) {
          return null;
        }
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            passwordHash: true,
            role: true,
            emailVerifiedAt: true,
          },
        });

        if (!user?.passwordHash || !user.emailVerifiedAt) return null;
        if (!(await compare(parsed.data.password, user.passwordHash))) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        const user = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, emailVerifiedAt: true },
        });
        if (!user || !user.emailVerifiedAt || !isUserRole(user.role)) return { ...session, user: undefined };
        session.user.id = token.sub;
        session.user.role = user.role;
      }
      return session;
    },
  },
});
