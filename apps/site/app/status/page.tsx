import type { Metadata } from "next";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { StatusDashboard } from "./StatusDashboard";

export const metadata: Metadata = {
  title: "Production status",
  description: "Transparent, weighted production readiness and live public-system checks for Project Ambient.",
  alternates: { canonical: "/status" },
  openGraph: {
    title: "Project Ambient production status",
    description: "Weighted delivery progress, remaining work, external gates, and live public checks.",
    url: "https://project-ambient.meekphillies.chatgpt.site/status",
  },
};

export default function StatusPage() {
  return (
    <div className="site-shell trust-shell status-shell">
      <Header />
      <StatusDashboard />
      <Footer />
    </div>
  );
}
