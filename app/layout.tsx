import type { Metadata } from "next";
import type { ReactNode } from "react";
import ThemeProvider from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000"),
  title: "Web Mondial — Retrouvez votre pronostiqueur",
  description:
    "Rejoignez l’espace de votre pronostiqueur et retrouvez vos communautés sportives sur Web Mondial.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" data-theme="dark" data-scroll-behavior="smooth">
      <body><ThemeProvider />{children}</body>
    </html>
  );
}
