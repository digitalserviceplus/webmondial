"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { strongPasswordPattern } from "@/lib/validation";

export default function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const [language, setLanguage] = useState("fr");
  useEffect(() => {
    const syncLanguage = () => setLanguage(document.documentElement.lang);
    syncLanguage();
    window.addEventListener("webmondial:preferences", syncLanguage);
    return () => window.removeEventListener("webmondial:preferences", syncLanguage);
  }, []);
  const showLabel = language === "en" ? "Show password" : language === "es" ? "Mostrar contraseña" : "Afficher le mot de passe";
  const hideLabel = language === "en" ? "Hide password" : language === "es" ? "Ocultar contraseña" : "Masquer le mot de passe";
  const newPasswordProps = props.autoComplete === "new-password"
    ? {
        pattern: strongPasswordPattern,
        maxLength: props.maxLength ?? 128,
        title: props.title ?? "12 caractères minimum, avec une majuscule, une minuscule et un chiffre.",
      }
    : {};
  return (
    <span className="password-input">
      <input {...newPasswordProps} {...props} className={props.className ?? "text-field"} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-visibility"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </span>
  );
}
