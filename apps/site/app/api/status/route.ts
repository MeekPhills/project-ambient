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
    probeUrl: "https://project-ambient.meekphillies.chatgpt.site",
    accept: "text/html",
    inspect: (body) => body.includes("Project Ambient")
      ? { state: "operational", detail: "Launch page is serving the current project" }
      : { state: "degraded", detail: "Site responded without the expected project marker" },
  },
  {
    id: "repository",
    label: "GitHub repository",
    publicUrl: "https://github.com/MeekPhills/project-ambient",
    phaseId: phaseFor("repository"),
    probeUrl: "https://api.github.com/repos/MeekPhills/project-ambient",
    accept: "application/vnd.github+json",
    inspect: (body) => {
      const data = safelyParseJson(body) as { private?: boolean; default_branch?: string } | null;
      return data && data.private === false
        ? { state: "operational", detail: `Public repository · ${data.default_branch ?? "default"} branch` }
        : { state: "degraded", detail: "Repository metadata was not publicly readable" };
    },
  },
  {
    id: "release",
    label: "GitHub release",
    publicUrl: "https://github.com/MeekPhills/project-ambient/releases/tag/v0.1.0-alpha",
    phaseId: phaseFor("release"),
    probeUrl: "https://api.github.com/repos/MeekPhills/project-ambient/releases/tags/v0.1.0-alpha",
    accept: "application/vnd.github+json",
    inspect: (body) => {
      const data = safelyParseJson(body) as { draft?: boolean; prerelease?: boolean; assets?: unknown[] } | null;
      const assetCount = data?.assets?.length ?? 0;
      return data && data.draft === false && assetCount > 0
        ? { state: "operational", detail: `${data.prerelease ? "Public prerelease" : "Public release"} · ${assetCount} assets` }
        : { state: "degraded", detail: "Release exists but is draft or has no public assets" };
    },
  },
  {
    id: "actions",
    label: "GitHub Actions",
    publicUrl: "https://github.com/MeekPhills/project-ambient/actions",
    phaseId: phaseFor("actions"),
    probeUrl: "https://api.github.com/repos/MeekPhills/project-ambient/actions/runs?branch=main&per_page=1",
    accept: "application/vnd.github+json",
    inspect: (body) => {
      const data = safelyParseJson(body) as { workflow_runs?: Array<{ conclusion?: string; status?: string }> } | null;
      const run = data?.workflow_runs?.[0];
      if (run?.status !== "completed") return { state: "degraded", detail: "Latest main workflow has not completed" };
      if (run.conclusion === "success") return { state: "operational", detail: "Latest main workflow passed" };
      return { state: "degraded", detail: `Latest main workflow concluded ${run.conclusion ?? "without a result"}` };
    },
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
    probeUrl: "https://api.github.com/repos/MeekPhills/project-ambient/discussions/1",
    accept: "application/vnd.github+json",
    inspect: (body) => {
      const data = safelyParseJson(body) as { state?: string; number?: number; title?: string } | null;
      return data?.state === "open" && data.number === 1
        ? { state: "operational", detail: data.title ?? "Launch discussion is open" }
        : { state: "degraded", detail: "Launch discussion is unavailable or closed" };
    },
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
