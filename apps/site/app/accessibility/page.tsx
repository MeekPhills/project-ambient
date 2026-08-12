import type { Metadata } from "next";
import { TrustPage } from "../components/TrustPage";

export const metadata: Metadata = { title: "Accessibility", description: "Project Ambient accessibility commitments and current alpha status." };

export default function AccessibilityPage() {
  return <TrustPage eyebrow="Accessibility" title="Atmosphere without barriers." summary="Project Ambient is being built so visual customization never depends on perfect vision, precise motion, or continuous animation.">
    <section><h2>Our target</h2><p>We aim for WCAG 2.2 AA across this website and meaningful VoiceOver, keyboard, and reduced-motion support in the macOS app. Accessibility is a release criterion, not a post-launch theme.</p></section>
    <section><h2>Website support</h2><p>This site uses semantic headings, visible keyboard focus, descriptive controls, scalable text, sufficient contrast, and a skip link. Motion pauses when your system requests reduced motion. Core information does not depend on color alone.</p></section>
    <section><h2>App behavior</h2><p>Channels, current state, schedules, and power decisions are presented as text as well as imagery. Wallpaper motion can be paused globally. The app is designed for keyboard navigation and native macOS accessibility APIs.</p></section>
    <section><h2>Known alpha limitations</h2><p>The alpha may contain incomplete VoiceOver descriptions in complex previews, and third-party video renderers have their own accessibility behavior. These issues will be tracked openly and prioritized before 1.0.</p></section>
    <section><h2>Feedback</h2><p>When reporting an accessibility issue, include the page or app view, the assistive technology and version, what you expected, and what happened. The support guide explains how to collect useful non-sensitive diagnostics.</p></section>
  </TrustPage>;
}
