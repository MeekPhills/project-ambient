import { Brand } from "./Brand";

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand-link" href="/" aria-label="Project Ambient home"><Brand /></a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="/#how-it-works">How it works</a>
          <a href="/#power">Power</a>
          <a href="/#open-source">Open source</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <a className="header-download" href="/downloads/Project-Ambient-alpha.zip" download>Source alpha <span aria-hidden="true">↓</span></a>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><span /><span /></summary>
          <nav aria-label="Mobile navigation">
            <a href="/#how-it-works">How it works</a><a href="/#power">Power</a><a href="/#open-source">Open source</a><a href="/#faq">FAQ</a>
            <a href="/downloads/Project-Ambient-alpha.zip" download>Source alpha ↓</a>
          </nav>
        </details>
      </div>
    </header>
  );
}
