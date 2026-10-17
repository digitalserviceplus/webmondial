"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Search, UserRound } from "lucide-react";
import { useLanguage } from "@/components/language-switcher";
import { messagesFor } from "@/lib/i18n";

type TenantResult = {
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
};

export default function TenantSearch() {
  const labels = messagesFor(useLanguage());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenantResult[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const [loadingQuery, setLoadingQuery] = useState("");
  const normalizedQuery = query.trim();
  const loading = loadingQuery === normalizedQuery && normalizedQuery.length >= 2;
  const visibleResults = resultQuery === normalizedQuery ? results : [];
  const visibleError = error?.query === normalizedQuery ? error.message : "";

  useEffect(() => {
    if (normalizedQuery.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingQuery(normalizedQuery);
      try {
        const response = await fetch(`/api/tenants?q=${encodeURIComponent(normalizedQuery)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("La recherche est temporairement indisponible.");
        setResults((await response.json()) as TenantResult[]);
        setResultQuery(normalizedQuery);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError({ query: normalizedQuery, message: "Impossible de charger les résultats. Réessayez dans un instant." });
        setResultQuery(normalizedQuery);
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoadingQuery("");
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  return (
    <div className="tenant-search" id="recherche">
      <label className="search-control">
        <Search size={19} aria-hidden="true" />
        <span className="sr-only">{labels.searchPlaceholder}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          autoComplete="off"
        />
        {loading && <span className="search-loading" aria-label="Recherche en cours" />}
      </label>
      {visibleError && <p className="search-message search-error" role="alert">{visibleError}</p>}
      {!visibleError && normalizedQuery.length >= 2 && !loading && visibleResults.length === 0 && (
        <p className="search-message">Aucun espace trouvé pour « {normalizedQuery} ».</p>
      )}
      {visibleResults.length > 0 && (
        <ul className="search-results" aria-label="Résultats de recherche">
          {visibleResults.map((tenant) => (
            <li key={tenant.handle}>
              <Link href={`/${tenant.handle}`} className="search-result">
                <span className="result-avatar">
                  {tenant.avatarUrl ? <Image src={tenant.avatarUrl} alt="" width={40} height={40} unoptimized /> : <UserRound size={20} />}
                </span>
                <span className="result-copy">
                  <strong>{tenant.displayName}</strong>
                  <span>@{tenant.handle}{tenant.bio ? ` · ${tenant.bio}` : ""}</span>
                </span>
                <ArrowRight size={17} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
