"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const labels = messagesFor(useLanguage());

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 360);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  if (!visible) return null;
  return (
    <button
      className="scroll-to-top"
      type="button"
      aria-label={labels.backToTop}
      title={labels.backToTop}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowUp size={19} />
    </button>
  );
}
