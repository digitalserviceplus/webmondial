"use client";

import { useEffect } from "react";

const THEME_KEY = "webmondial.theme";
const LANGUAGE_KEY = "webmondial.language";
const THEME_VERSION_KEY = "webmondial.theme-version";

export function applyPreferences(theme: string, language: string) {
  const root = document.documentElement;
  const selectedTheme = theme === "light" ? "light" : "dark";
  root.dataset.theme = selectedTheme;
  root.lang = ["fr", "en", "es"].includes(language) ? language : "fr";
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(LANGUAGE_KEY, root.lang);
  window.dispatchEvent(new CustomEvent("webmondial:preferences", { detail: { theme, language: root.lang } }));
}

export default function ThemeProvider() {
  useEffect(() => {
    const root = document.documentElement;
    let savedTheme = localStorage.getItem(THEME_KEY);
    if (localStorage.getItem(THEME_VERSION_KEY) !== "2") {
      if (savedTheme === "system") {
        savedTheme = "dark";
        localStorage.setItem(THEME_KEY, savedTheme);
      }
      localStorage.setItem(THEME_VERSION_KEY, "2");
    }
    savedTheme ??= "dark";
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY) ?? "fr";
    applyPreferences(savedTheme, savedLanguage);
  }, []);

  return null;
}
