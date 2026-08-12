import type { Metadata } from "next";
import { TrustPage } from "../components/TrustPage";

export const metadata: Metadata = { title: "Security", description: "Project Ambient security model and vulnerability reporting guidance." };

export default function SecurityPage() {
  return <TrustPage eyebrow="Security" title="Small surface. Visible boundaries." summary="Project Ambient minimizes network dependencies, uses user-selected file access, and keeps sensitive operations explicit.">
    <section><h2>Security model</h2><p>The native app is built around least privilege. It asks for folders through the macOS picker, stores operational state locally, and uses public system APIs for static wallpaper changes. Optional adapters and AI controls are separate surfaces with their own documented permissions.</p></section>
    <section><h2>AI tool safety</h2><p>Every control tool declares whether it only reads state or can change it. Destructive operations are not bundled into broad “do everything” calls. Remote access is not silently enabled, and local control does not open a public network listener by default.</p></section>
    <section><h2>Release integrity</h2><p>Public releases are intended to be reproducible from source. Signed and notarized macOS distributions will publish checksums alongside release artifacts. Alpha bundles that are not yet notarized are clearly identified.</p></section>
    <section><h2>Report a vulnerability</h2><p>Please do not publish an exploitable issue before maintainers have a reasonable opportunity to investigate. Use the private security-advisory channel on the project’s source repository when it becomes public; include the affected version, macOS version, reproduction steps, and potential impact.</p></section>
    <section><h2>Supported versions</h2><p>During alpha, only the newest published build receives security fixes. We will document a longer support window before a stable 1.0 release.</p></section>
  </TrustPage>;
}
