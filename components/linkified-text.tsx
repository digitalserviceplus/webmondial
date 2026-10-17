import type { ReactNode } from "react";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/giu;

export function LinkifiedText({ children }: { children: string }) {
  const segments: ReactNode[] = [];
  let offset = 0;
  for (const match of children.matchAll(urlPattern)) {
    const value = match[0];
    const start = match.index;
    if (start === undefined) continue;
    segments.push(children.slice(offset, start));
    const punctuation = /[.,!?;:)\]}]+$/u.exec(value)?.[0] ?? "";
    const label = punctuation ? value.slice(0, -punctuation.length) : value;
    const href = label.toLowerCase().startsWith("www.") ? `https://${label}` : label;
    segments.push(
      <a href={href} key={`${start}-${label}`} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
      punctuation,
    );
    offset = start + value.length;
  }
  segments.push(children.slice(offset));
  return <>{segments}</>;
}
