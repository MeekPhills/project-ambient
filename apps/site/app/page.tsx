import type { Metadata } from "next";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { DOWNLOAD_URL, SOURCE_URL } from "./lib/links";

export const metadata: Metadata = {
  title: "Your collection, alive at the right moment",
  description: "Project Ambient organizes your own photos and videos into power-aware smart wallpaper channels on macOS.",
};

export default function Home() {
  return (
    <div className="site-shell">
      <Header />
      <main id="main-content">
        <section className="hero section-pad" aria-labelledby="hero-title">
          <div className="hero-glow hero-glow-one" aria-hidden="true" />
          <div className="hero-glow hero-glow-two" aria-hidden="true" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="eyebrow"><span /> Open-source wallpaper intelligence for macOS</p>
              <h1 id="hero-title">Your collection, <em>alive</em> at the right moment.</h1>
              <p className="hero-lede">Project Ambient turns the photos and videos you already own into smart channels—then chooses what fits your time, energy state, and attention. Your media stays yours.</p>
              <div className="hero-actions">
                <a className="button button-primary" href={DOWNLOAD_URL}>Download unsigned alpha <span aria-hidden="true">↓</span></a>
                <a className="button button-ghost" href="#how-it-works">See how it works <span aria-hidden="true">↘</span></a>
              </div>
              <div className="hero-notes" aria-label="Product highlights"><span><i className="status-dot" /> macOS 14+ · Apple silicon</span><span>Local-first</span><span>Open source</span></div>
              <p className="alpha-disclosure"><strong>Unsigned alpha.</strong> Apple credentials are pending, so Gatekeeper may block the app. Build from source for now.</p>
            </div>

            <div className="product-stage" aria-label="Project Ambient product preview">
              <div className="desktop-frame">
                <div className="desktop-bar"><div className="traffic-lights" aria-hidden="true"><i /><i /><i /></div><span>Project Ambient</span><div className="power-pill"><i /> Efficient</div></div>
                <div className="desktop-body">
                  <aside className="channel-rail" aria-label="Smart channels">
                    <p>Smart channels</p>
                    <div className="channel active"><i className="swatch coral" /> Golden hour <b>24</b></div>
                    <div className="channel"><i className="swatch aqua" /> Shorelines <b>18</b></div>
                    <div className="channel"><i className="swatch violet" /> City nights <b>31</b></div>
                    <div className="channel"><i className="swatch green" /> Quiet nature <b>42</b></div>
                    <button className="rail-add" type="button" aria-label="Add a smart channel">+ New channel</button>
                  </aside>
                  <div className="wallpaper-canvas">
                    <div className="sun" aria-hidden="true" /><div className="horizon horizon-back" aria-hidden="true" /><div className="horizon horizon-front" aria-hidden="true" />
                    <div className="canvas-topline"><span>NOW PLAYING</span><button type="button" aria-label="More wallpaper options">•••</button></div>
                    <div className="now-card"><p><span className="pulse" /> LIVE CHANNEL</p><h2>Golden hour</h2><span>South coast · 6:38 PM</span><div className="now-controls"><button type="button" aria-label="Previous wallpaper">←</button><button className="pause" type="button" aria-label="Pause wallpaper rotation">Ⅱ</button><button type="button" aria-label="Next wallpaper">→</button></div></div>
                  </div>
                </div>
              </div>
              <div className="decision-card"><div><span>NOW</span><strong>Golden hour</strong></div><div><span>NEXT</span><strong>City lights · 7:42</strong></div><div><span>WHY</span><strong>Evening · plugged in · desktop visible</strong></div></div>
            </div>
          </div>
        </section>

        <section className="signal-strip" aria-label="Project Ambient principles"><div className="signal-track"><span>YOUR MEDIA</span><i>✦</i><span>ON-DEVICE ORGANIZATION</span><i>✦</i><span>POWER-AWARE PLAYBACK</span><i>✦</i><span>EXPLAINABLE CHOICES</span><i>✦</i><span>YOUR MEDIA</span><i>✦</i><span>ON-DEVICE ORGANIZATION</span></div></section>

        <section className="workflow section-pad" id="how-it-works" aria-labelledby="workflow-title">
          <div className="container">
            <div className="section-heading split-heading"><div><p className="kicker">The quiet intelligence layer</p><h2 id="workflow-title">From camera roll to living desktop.</h2></div><p>No feed to train. No cloud library to rebuild. Point Ambient at a folder and shape the behavior in plain language.</p></div>
            <ol className="workflow-grid">
              <li><span className="step-number">01</span><div className="step-icon folder-icon" aria-hidden="true"><i /></div><h3>Bring your library</h3><p>Choose any folder of photos and videos. Ambient watches it without moving or duplicating a thing.</p><small>LOCAL FILE ACCESS</small></li>
              <li><span className="step-number">02</span><div className="step-icon constellation-icon" aria-hidden="true"><i /><i /><i /></div><h3>Make smart channels</h3><p>On-device vision groups scenes into useful channels. Rename, refine, or build your own.</p><small>EXPLAINABLE TAGS</small></li>
              <li><span className="step-number">03</span><div className="step-icon rule-icon" aria-hidden="true"><i /><i /></div><h3>Set the rhythm</h3><p>Schedule calm mornings, personal game-day memories, or a still frame whenever energy is constrained.</p><small>TIME + POWER RULES</small></li>
              <li><span className="step-number">04</span><div className="step-icon display-icon" aria-hidden="true"><i /></div><h3>Let macOS render</h3><p>Use the public macOS wallpaper path for stills or send video collections to Aerial.</p><small>PUBLIC APIS · AERIAL</small></li>
            </ol>
          </div>
        </section>

        <section className="moment-section section-pad" aria-labelledby="moment-title">
          <div className="container moment-grid">
            <div className="moment-visual" aria-hidden="true"><div className="ambient-orb orb-one" /><div className="ambient-orb orb-two" /><div className="ambient-orb orb-three" /><div className="moment-label label-one"><span>08:10</span>Quiet coast</div><div className="moment-label label-two"><span>18:42</span>Golden hour</div><div className="moment-label label-three"><span>22:15</span>City glow</div><div className="time-ring"><i /><b>RIGHT<br />NOW</b></div></div>
            <div className="moment-copy"><p className="kicker">Now / Next / Why</p><h2 id="moment-title">A wallpaper system that can explain itself.</h2><p>Ambient never hides the rule behind the result. See what is on, what comes next, and the exact signals that made the choice.</p><dl className="reason-list"><div><dt>Now</dt><dd>Quiet Coast because your workday just started</dd></div><div><dt>Next</dt><dd>Golden Hour at 6:42 PM</dd></div><div><dt>Why</dt><dd>Weekday · morning · external display · on power</dd></div></dl></div>
          </div>
        </section>

        <section className="power-section section-pad" id="power" aria-labelledby="power-title">
          <div className="container power-grid">
            <div className="power-copy"><p className="kicker light-kicker">Designed to disappear</p><h2 id="power-title">Motion when it matters. Stillness when it doesn’t.</h2><p>The alpha renders efficient stills itself and hands video channels to Aerial, whose own power controls remain in charge.</p><ul className="check-list"><li><span>✓</span> Applies stills without continuous decoding</li><li><span>✓</span> Honors Low Power Mode in automatic policy</li><li><span>✓</span> Makes every video handoff explicit</li><li><span>✓</span> Shows exactly which power policy is active</li></ul></div>
            <div className="energy-panel"><div className="energy-head"><span>ENERGY BEHAVIOR</span><b>ALPHA</b></div><div className="energy-row"><div><p>Static channel</p><span>No continuous decoder</span></div><div className="meter"><i className="meter-8" /></div><b className="mode-tag paused">STILL</b></div><div className="energy-row"><div><p>Video channel</p><span>Explicit Aerial handoff</span></div><div className="meter"><i className="meter-72" /></div><b className="mode-tag motion">AERIAL</b></div><div className="energy-row"><div><p>Low Power Mode</p><span>Automatic stays still</span></div><div className="meter"><i className="meter-22" /></div><b className="mode-tag still">STILL</b></div><div className="energy-foot"><i /> No background uploads or remote analysis</div></div>
          </div>
        </section>

        <section className="control-section section-pad" aria-labelledby="control-title"><div className="container"><div className="section-heading split-heading"><div><p className="kicker">Control it your way</p><h2 id="control-title">A Mac app first. An open control layer everywhere.</h2></div><p>Use the visual app, system shortcuts, or an AI assistant. Every control arrives through the same documented, permission-aware layer.</p></div><div className="control-grid">
          <article className="control-card command-card"><div className="card-label">AI CONTROL</div><div className="command-bubble">“Switch to Shorelines until sunset.”</div><div className="command-result"><span>✓</span><div><b>Shorelines is active</b><small>Until 7:58 PM · Low-power rules preserved</small></div></div><h3>Natural language, bounded actions.</h3><p>Local MCP tools expose clear read and write operations—with confirmation for changes.</p></article>
          <article className="control-card aerial-card"><div className="card-label">VIDEO PLAYBACK</div><div className="aerial-mark" aria-hidden="true"><i /><i /><i /></div><h3>Already at home with Aerial.</h3><p>Keep the best open-source video renderer you already trust. Ambient organizes and exports the playlists.</p><span className="compat-pill">AERIAL-COMPATIBLE</span></article>
          <article className="control-card api-card"><div className="card-label">OPEN BY DESIGN</div><div className="code-lines" aria-hidden="true"><span><i>01</i><b>ambient.activate_channel</b></span><span><i>02</i><b>ambient.explain_current</b></span><span><i>03</i><b>ambient.set_power_mode</b></span></div><h3>Public APIs. Portable state.</h3><p>Your rules and channel definitions live in readable files—not inside an account you can lose.</p></article>
        </div></div></section>

        <section className="open-source-section section-pad" id="open-source" aria-labelledby="open-title"><div className="container open-grid"><div><p className="kicker">Built in the open</p><h2 id="open-title">Not another wallpaper store.</h2><p>Project Ambient is infrastructure for your collection. The core is auditable, forkable, and built around public platform APIs. Community adapters can add new organizers, renderers, and rules.</p><div className="open-actions"><a className="text-link" href={SOURCE_URL}>Get the source bundle <span>→</span></a><a className="text-link" href="/security">Read the security model <span>→</span></a></div></div><div className="principle-stack"><article><span>01</span><div><h3>Local by default</h3><p>Folders, labels, and decisions stay on your Mac.</p></div></article><article><span>02</span><div><h3>Permission-aware</h3><p>AI actions declare whether they read or change state.</p></div></article><article><span>03</span><div><h3>Renderer-neutral</h3><p>Use public macOS APIs, Aerial, or build an adapter.</p></div></article></div></div></section>

        <section className="faq-section section-pad" id="faq" aria-labelledby="faq-title"><div className="container faq-grid"><div><p className="kicker">Good questions</p><h2 id="faq-title">Before you install.</h2><p>Project Ambient is launching as an alpha. Expect a useful core and a fast-moving edge.</p></div><div className="faq-list">
          <details><summary>Does Ambient upload my photos or videos?<span>+</span></summary><p>No. Local organization and wallpaper decisions happen on your Mac. Optional remote features will always be off until you enable them.</p></details>
          <details><summary>Is it a replacement for Aerial?<span>+</span></summary><p>No. Ambient can render still wallpapers with public macOS APIs and treats Aerial as a first-class video playback adapter.</p></details>
          <details><summary>What does “power-aware” mean?<span>+</span></summary><p>The alpha applies static wallpapers without continuous media decoding and keeps automatic policy still during Low Power Mode. Aerial controls the power behavior of any video you explicitly export to it.</p></details>
          <details><summary>Can I use sports photos and personal media?<span>+</span></summary><p>Yes—use media you own or have permission to display. Ambient provides organization and playback; it does not bundle licensed team footage.</p></details>
          <details><summary>Which Macs are supported?<span>+</span></summary><p>The downloadable alpha targets Apple silicon Macs running macOS 14 or later. Intel owners can build from source; a universal signed build is planned.</p></details>
        </div></div></section>

        <section className="final-cta section-pad" aria-labelledby="cta-title"><div className="container cta-inner"><div className="cta-orbit" aria-hidden="true"><i /><i /><i /></div><p className="kicker">The alpha is ready</p><h2 id="cta-title">Let your desktop remember what you love.</h2><p>Bring your own collection. Keep it on your Mac. Change the atmosphere without changing your energy bill.</p><a className="button button-primary" href={DOWNLOAD_URL}>Download unsigned alpha <span aria-hidden="true">↓</span></a><div className="signing-notice"><strong>Preview status</strong><span>Not signed or notarized yet. Gatekeeper may block the app; building from source is recommended until Apple credentials are connected.</span></div><small>Free · open source · Apple silicon · macOS 14+</small></div></section>
      </main>
      <Footer />
    </div>
  );
}
