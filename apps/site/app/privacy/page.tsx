import type { Metadata } from "next";
import { TrustPage } from "../components/TrustPage";

export const metadata: Metadata = { title: "Privacy", description: "How Project Ambient handles your media, preferences, and optional connectivity." };

export default function PrivacyPage() {
  return <TrustPage eyebrow="Privacy" title="Your collection stays yours." summary="Project Ambient is designed around a simple boundary: the app can work without sending your media or its labels to us.">
    <section><h2>The short version</h2><p>Project Ambient reads folders you explicitly choose. By default, it analyzes media on your Mac, stores channel definitions and preferences locally, and does not require an account. The alpha does not include advertising, tracking pixels, behavioral analytics, or a cloud media library.</p></section>
    <section><h2>Files and on-device analysis</h2><p>The app accesses only the files and folders you select through macOS. Scene labels, thumbnails, channel membership, schedules, and current wallpaper history are generated and stored locally. Project Ambient does not claim ownership of your media.</p></section>
    <section><h2>Network activity</h2><p>The core experience works offline. A future update check may contact a release endpoint to learn whether a newer version exists; it need not include your media or channel names. Optional remote-control features will be clearly labeled, disabled by default, and documented before release.</p></section>
    <section><h2>AI controls</h2><p>Local MCP controls can read Project Ambient’s operational state and perform the actions you approve. Read and change operations are separated and labeled. If you connect a third-party assistant, that provider’s privacy terms also apply to messages and tool data sent through that assistant.</p></section>
    <section><h2>Deletion and portability</h2><p>You can remove a source folder at any time without deleting the original files. Project state is stored in readable local data and can be removed from the app. Uninstalling the app does not delete your media.</p></section>
    <section><h2>Changes</h2><p>Material privacy changes will be documented in the release notes and reflected on this page with a new effective date.</p></section>
  </TrustPage>;
}
