import { Footer } from "./components/Footer";
import { Header } from "./components/Header";

export default function NotFound() {
  return <div className="site-shell trust-shell"><Header /><main id="main-content" className="not-found"><p className="kicker">404 · Off channel</p><h1>This moment isn’t in the rotation.</h1><p>The page may have moved, but your collection is still right where you left it.</p><a className="button button-primary" href="/">Return home →</a></main><Footer /></div>;
}
