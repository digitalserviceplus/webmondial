"use client";

import { useEffect, useState } from "react";

export default function NotificationBadge({ initialCount }: { initialCount: number }) {
  const [refreshedCount, setRefreshedCount] = useState<number | null>(null);
  const count = refreshedCount ?? initialCount;

  useEffect(() => {
    const timer = window.setTimeout(() => setRefreshedCount(null), 0);
    return () => window.clearTimeout(timer);
  }, [initialCount]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/notifications?unreadCount=1", { cache: "no-store" });
        if (!response.ok) throw new Error(`Notification count request failed (${response.status}).`);
        const result: { unreadCount: number } = await response.json();
        if (active) setRefreshedCount(result.unreadCount);
      } catch (error) {
        console.error("Unable to refresh the notification count.", error);
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void refresh();
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return count > 0 ? <span className="nav-count">{count}</span> : null;
}
