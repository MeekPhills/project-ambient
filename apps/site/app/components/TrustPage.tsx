import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

type TrustPageProps = { eyebrow: string; title: string; summary: string; updated?: string; children: ReactNode };

export function TrustPage({ eyebrow, title, summary, updated = "August 12, 2026", children }: TrustPageProps) {
  return (
    <div className="site-shell trust-shell"><Header /><main id="main-content" className="trust-main">
      <header className="trust-hero"><div className="container trust-hero-grid"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1></div><div><p>{summary}</p><span>Last updated {updated}</span></div></div></header>
      <article className="container trust-content">{children}</article>
    </main><Footer /></div>
  );
}
