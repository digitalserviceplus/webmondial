"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { applyPreferences } from "@/components/theme-provider";
import { message, type Language } from "@/lib/i18n";

const languages: Array<{ value: Language; label: string }> = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function useLanguage() {
  const [language, setLanguage] = useState<Language>("fr");
  useEffect(() => {
    const sync = () => {
      const selected = document.documentElement.lang;
      setLanguage(selected === "en" || selected === "es" ? selected : "fr");
    };
    sync();
    window.addEventListener("webmondial:preferences", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("webmondial:preferences", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return language;
}

export function T({ id, fallback }: { id: string; fallback?: string }) {
  const language = useLanguage();
  const translated = message(language, id);
  return translated === id ? fallback ?? id : translated;
}

export function LocalizedDate({ date }: { date: string }) {
  const language = useLanguage();
  const locale = language === "fr" ? "fr-FR" : language === "es" ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date));
}

export default function LanguageSwitcher({ className = "" }: { className?: string }) {
  const router = useRouter();
  const language = useLanguage();
  const [error, setError] = useState("");
  function changeLanguage(nextLanguage: Language) {
    const savedTheme = localStorage.getItem("webmondial.theme") ?? "dark";
    applyPreferences(savedTheme, nextLanguage);
    setError("");
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: nextLanguage }),
    }).then(async (response) => {
      if (response.status === 401) return;
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? message(language, "languageSaveError"));
      }
      router.refresh();
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : message(language, "languageSaveError"));
    });
  }
  return (
    <div className={`language-switcher ${className}`.trim()}>
      <label>
        <span className="sr-only">{message(language, "languageLabel")}</span>
        <select
          aria-label={message(language, "languageLabel")}
          value={language}
          onChange={(event) => changeLanguage(event.target.value as Language)}
        >
          {languages.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      {error && <span className="language-switcher-error" role="status">{error}</span>}
    </div>
  );
}
