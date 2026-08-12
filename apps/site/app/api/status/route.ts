import { statusManifest, type LiveCheck, type LiveCheckResponse, type LiveState } from "../../status/status-model";

type ProbeResult = { state: LiveState; detail: string };
type Probe = {
  id: string;
  label: string;
  publicUrl: string;
  phaseId: string;
  probeUrl: string;
  accept: string;
  inspect: (body: string) => ProbeResult;
};

function phaseFor(checkId: string) {
  return statusManifest.liveChecks.find((check) => check.id === checkId)?.phaseId ?? "native-distribution";
}

const probes: Probe[] = [
  {
    id: "site",
    label: "Public site",
    publicUrl: "https://project-ambient.meekphillies.chatgpt.site",
    phaseId: phaseFor("site"),
    probeUrl: "https://project-ambient.meekphillies.chatgpt.site/favicon.svg",
    accept: "image/svg+xml",
    inspect: (body) => body.includes("#D9FF6C")
      ? { state: "operational", detail: "Production site assets are serving the current brand" }
      : { state: "degraded", detail: "Site responded without the current brand marker" },
  },
  {
    id: "repository",
    label: "GitHub repository",
    publicUrl: "https://github.com/MeekPhills/project-ambient",
    phaseId: phaseFor("repository"),
    probeUrl: "https://raw.githubusercontent.com/MeekPhills/project-ambient/main/README.md",
    accept: "text/plain",
    inspect: (body) => body.includes("# Project Ambient")
      ? { state: "operational", detail: "Public repository · main branch" }
      : { state: "degraded", detail: "Repository README was not publicly readable" },
  },
  {
    id: "release",
    label: "GitHub release",
    publicUrl: "https://github.com/MeekPhills/project-ambient/releases/tag/v0.1.0-alpha",
    phaseId: phaseFor("release"),
    probeUrl: "https://img.shields.io/github/v/release/MeekPhills/project-ambient?include_prereleases",
    accept: "image/svg+xml",
    inspect: (body) => body.includes("release: v0.1.0-alpha")
      ? { state: "operational", detail: "Public prerelease · v0.1.0-alpha" }
      : { state: "degraded", detail: "Release badge did not report the expected version" },
  },
  {
    id: "actions",
    label: "GitHub Actions",
    publicUrl: "https://github.com/MeekPhills/project-ambient/actions",
    phaseId: phaseFor("actions"),
    probeUrl: "https://img.shields.io/github/actions/workflow/status/MeekPhills/project-ambient/ci.yml?branch=main",
    accept: "image/svg+xml",
    inspect: (body) => body.includes("build: passing")
      ? { state: "operational", detail: "Latest main CI workflow passed" }
      : { state: "degraded", detail: "Main CI badge is not passing" },
  },
  {
    id: "homebrew",
    label: "Homebrew tap",
    publicUrl: "https://github.com/MeekPhills/homebrew-tap",
    phaseId: phaseFor("homebrew"),
    probeUrl: "https://raw.githubusercontent.com/MeekPhills/homebrew-tap/main/Casks/project-ambient.rb",
    accept: "text/plain",
    inspect: (body) => /version\s+"0\.1\.0-alpha"/.test(body) && /sha256\s+"[a-f0-9]{64}"/.test(body)
      ? { state: "operational", detail: "Cask 0.1.0-alpha · checksum pinned" }
      : { state: "degraded", detail: "Tap responded without the expected version or checksum" },
  },
  {
    id: "discussion",
    label: "Launch discussion",
    publicUrl: "https://github.com/MeekPhills/project-ambient/discussions/1",
    phaseId: phaseFor("discussion"),
    probeUrl: "https://img.shields.io/github/discussions/MeekPhills/project-ambient",
    accept: "image/svg+xml",
    inspect: (body) => /discussions: [1-9][0-9]* total/.test(body)
      ? { state: "operational", detail: "Public launch discussion is available" }
      : { state: "degraded", detail: "Discussion badge did not report a public thread" },
  },
  {
    id: "mcp",
    label: "MCP health",
    publicUrl: "https://project-ambient-control.vercel.app/health",
    phaseId: phaseFor("mcp"),
    probeUrl: "https://project-ambient-control.vercel.app/health",
    accept: "application/json",
    inspect: (body) => {
      const data = safelyParseJson(body) as { status?: string; version?: string; adapter?: string } | null;
      return data?.status === "ok"
        ? { state: "operational", detail: `v${data.version ?? "unknown"} · ${data.adapter ?? "unknown"} adapter` }
        : { state: "degraded", detail: "Health endpoint responded without an OK service state" };
    },
  },
];

let cached: { expiresAt: number; response: LiveCheckResponse } | null = null;
let inFlight: Promise<LiveCheckResponse> | null = null;

function safelyParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function runProbe(probe: Probe): Promise<LiveCheck> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(probe.probeUrl, {
      headers: {
        accept: probe.accept,
        "user-agent": "Project-Ambient-Public-Status/0.1",
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const checkedAt = new Date().toISOString();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        id: probe.id,
        label: probe.label,
        url: probe.publicUrl,
        state: response.status >= 500 ? "unavailable" : "degraded",
        httpStatus: response.status,
        latencyMs,
        detail: `Public endpoint returned HTTP ${response.status}`,
        checkedAt,
        phaseId: probe.phaseId,
      };
    }

    const body = await response.text();
    const inspected = probe.inspect(body);
    return {
      id: probe.id,
      label: probe.label,
      url: probe.publicUrl,
      state: inspected.state,
      httpStatus: response.status,
      latencyMs,
      detail: inspected.detail,
      checkedAt,
      phaseId: probe.phaseId,
    };
  } catch (error) {
    return {
      id: probe.id,
      label: probe.label,
      url: probe.publicUrl,
      state: "unavailable",
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof DOMException && error.name === "AbortError"
        ? "Public check timed out after 8 seconds"
        : "Public check could not reach the endpoint",
      checkedAt: new Date().toISOString(),
      phaseId: probe.phaseId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runAllChecks(): Promise<LiveCheckResponse> {
  const checks = await Promise.all(probes.map(runProbe));
  return { checkedAt: new Date().toISOString(), checks };
}

export async function GET() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return statusResponse(cached.response, "HIT");
  }

  inFlight ??= runAllChecks().finally(() => {
    inFlight = null;
  });
  const response = await inFlight;
  cached = { expiresAt: Date.now() + 45_000, response };
  return statusResponse(response, "MISS");
}

function statusResponse(payload: LiveCheckResponse, cacheState: "HIT" | "MISS") {
  return Response.json(payload, {
    headers: {
      "cache-control": "public, max-age=0, s-maxage=45, stale-while-revalidate=120",
      "x-content-type-options": "nosniff",
      "x-status-cache": cacheState,
    },
  });
}
