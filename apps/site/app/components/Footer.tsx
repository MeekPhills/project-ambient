import { Brand } from "./Brand";
import { DOWNLOAD_URL, REPOSITORY_URL } from "../lib/links";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand"><a className="brand-link" href="/" aria-label="Project Ambient home"><Brand /></a><p>Your collection, alive at the right moment.</p><span>Built thoughtfully for macOS.</span></div>
        <nav aria-label="Product links"><strong>Product</strong><a href="/#how-it-works">How it works</a><a href="/#power">Power behavior</a><a href={REPOSITORY_URL}>Source code</a><a href={DOWNLOAD_URL}>Download</a></nav>
        <nav aria-label="Trust links"><strong>Trust</strong><a href="/privacy">Privacy</a><a href="/security">Security</a><a href="/accessibility">Accessibility</a><a href="/terms">Terms</a></nav>
        <nav aria-label="Help links"><strong>Help</strong><a href="/support">Support</a><a href="/#faq">FAQ</a><a href="/support#diagnostics">Report an issue</a></nav>
      </div>
      <div className="container footer-bottom"><span>© {new Date().getFullYear()} Project Ambient contributors</span><span>Open source. No wallpaper marketplace. No tracking pixels.</span></div>
    </footer>
  );
}
