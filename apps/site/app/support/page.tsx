import type { Metadata } from "next";
import { TrustPage } from "../components/TrustPage";

export const metadata: Metadata = { title: "Support", description: "Install help, troubleshooting, and issue-reporting guidance for Project Ambient." };

export default function SupportPage() {
  return <TrustPage eyebrow="Support" title="Get unstuck without giving up your privacy." summary="Start with the quick checks below. Diagnostics are designed to be readable and safe to review before you share them.">
    <section><h2>Install the alpha</h2><p>The current download is unsigned and not notarized because Apple signing credentials are not yet connected. Gatekeeper may prevent it from opening. Building from the included source is the recommended path until a signed release is published.</p><ol><li>Download and unzip the Project Ambient source alpha.</li><li>Follow the included build-from-source instructions.</li><li>Open it and select a folder containing media you have permission to use.</li><li>Choose a smart channel, review its reason, then apply it.</li></ol></section>
    <section><h2>Common checks</h2><h3>A folder looks empty</h3><p>Confirm the files use a supported photo or video format and that the app still has access to the folder. Remove and re-add the folder if its location changed.</p><h3>A video does not play</h3><p>Check whether Low Power Mode or a still-only policy is active. For live video channels, confirm Aerial is installed and the collection was exported successfully.</p><h3>The wallpaper did not change</h3><p>Make sure the display is connected, the current rule is enabled, and macOS has not removed the source file. Try Apply now from the channel view.</p></section>
    <section id="diagnostics"><h2>Report a useful issue</h2><p>Include the Project Ambient version, macOS version, Mac model, expected result, and exact steps that produced the problem. Copy diagnostics from the app only after reviewing them. Never attach your media, full file paths, account tokens, or other private data unless you deliberately choose to.</p></section>
    <section><h2>Where to report</h2><p>Use the Issues area of the public source repository for bugs and feature requests. Use its private Security Advisories area for vulnerabilities. Those links will appear in the app and release notes when the repository is made public.</p></section>
  </TrustPage>;
}
