"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

export default function DashboardNavigation({
  caption,
  currentLabel,
  children,
}: {
  caption: string;
  currentLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className={`dashboard-menu ${open ? "dashboard-menu-open" : ""}`}>
      <button
        className="dashboard-menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="dashboard-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
        <span>{currentLabel}</span>
        <ChevronDown className="dashboard-menu-chevron" size={16} />
      </button>
      <div className="dashboard-menu-content">
        <div className="sidebar-caption">{caption}</div>
        <nav className="dashboard-navigation" id="dashboard-navigation" aria-label={caption}>
          {children}
        </nav>
      </div>
    </div>
  );
}
