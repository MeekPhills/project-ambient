import type { Metadata } from "next";
import { TrustPage } from "../components/TrustPage";

export const metadata: Metadata = { title: "Terms", description: "Plain-language terms for the Project Ambient alpha." };

export default function TermsPage() {
  return <TrustPage eyebrow="Terms" title="Alpha software, clear expectations." summary="These terms describe the public Project Ambient alpha. The open-source license remains the controlling license for source code distribution.">
    <section><h2>Using Project Ambient</h2><p>You may use the alpha to organize and display media you own or have permission to use. You are responsible for the rights to photos, videos, trademarks, and other content you add.</p></section>
    <section><h2>Open-source license</h2><p>Source code and included documentation are provided under the license included with the release bundle. If these website terms conflict with that license about use, copying, modification, or distribution of the code, the open-source license controls.</p></section>
    <section><h2>Alpha status</h2><p>This is prerelease software. Features, data formats, system requirements, integrations, and behavior may change. Back up important configuration before upgrading and keep the original copies of your media.</p></section>
    <section><h2>No bundled content rights</h2><p>Project Ambient does not grant rights to third-party photos, videos, sports footage, team marks, music, or other media. Adapters and community channel files must respect their source licenses.</p></section>
    <section><h2>Warranty and liability</h2><p>The alpha is provided “as is,” without warranties to the extent permitted by law. The project contributors are not liable for indirect, incidental, special, or consequential loss arising from use of the software.</p></section>
    <section><h2>Responsible use</h2><p>Do not use Project Ambient to violate privacy, intellectual-property rights, platform security, or applicable law. Do not present community-built adapters as official unless they are maintained by the project.</p></section>
  </TrustPage>;
}
