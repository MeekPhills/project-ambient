import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const statusManifest = JSON.parse(
  await readFile(new URL("../app/status/status-manifest.json", import.meta.url), "utf8"),
);
const statusRouteSource = await readFile(new URL("../app/api/status/route.ts", import.meta.url), "utf8");

const routes = [
  ["/", /Your collection,.*alive.*right moment/is],
  ["/privacy", /Your collection stays yours/i],
  ["/terms", /Alpha software, clear expectations/i],
  ["/security", /Small surface.*Visible boundaries/is],
  ["/accessibility", /Atmosphere without barriers/i],
  ["/support", /Get unstuck without giving up your privacy/i],
  ["/status", /Delivery, without the hand-waving/i],
];

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

for (const [pathname, expected] of routes) {
  test(`server-renders ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, expected);
    assert.match(html, /Project Ambient/);
    assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  });
}

test("homepage exposes launch and trust paths", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /Project-Ambient-0\.1\.0-alpha\.zip/);
  assert.match(html, /Unsigned alpha/i);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/security"/);
  assert.match(html, /og-project-ambient\.png/);
  assert.match(html, /href="\/status"/);
});

test("status manifest is a fixed, conservative 100-point audit", () => {
  const phaseWeight = statusManifest.phases.reduce((sum, phase) => sum + phase.weight, 0);
  assert.equal(statusManifest.schemaVersion, 2);
  assert.equal(statusManifest.totalWeight, 100);
  assert.equal(phaseWeight, statusManifest.totalWeight);
  assert.match(statusManifest.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(statusManifest.evidenceAsOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(statusManifest.automation.skill, "project-ambient-status");
  assert.equal(statusManifest.automation.agent, "Project Ambient Status Bot");
  assert.equal(statusManifest.automation.weightedAuditCadence, "Every 6 hours and on demand");
  assert.equal(statusManifest.automation.liveHealthCadence, "Every 60 seconds");
  assert.deepEqual(statusManifest.phases.map((phase) => phase.weight), [45, 45, 10]);
  assert.equal(statusManifest.deliveryWorkstreams.length, 4);

  const statuses = new Set();
  const tasks = statusManifest.phases.flatMap((phase) => {
    assert.equal(
      phase.tasks.reduce((sum, task) => sum + task.weight, 0),
      phase.weight,
      `${phase.id} task weights must equal its phase weight`,
    );
    return phase.tasks;
  });

  const earned = tasks.reduce((sum, task) => {
    statuses.add(task.status);
    assert.ok(task.earnedWeight >= 0 && task.earnedWeight <= task.weight);
    assert.ok(task.hoursRemaining.min >= 0);
    assert.ok(task.hoursRemaining.max >= task.hoursRemaining.min);
    if (task.status === "complete") assert.equal(task.earnedWeight, task.weight);
    if (task.status === "blocked" || task.status === "not_started") assert.equal(task.earnedWeight, 0);
    if (task.externalApproval && task.status !== "complete") assert.equal(task.earnedWeight, 0);
    return sum + (task.status === "complete" || task.status === "in_progress" ? task.earnedWeight : 0);
  }, 0);

  assert.deepEqual(
    [...statuses].sort(),
    ["blocked", "complete", "in_progress", "not_started"].sort(),
  );
  assert.equal(earned, 44.5);
  assert.equal(Math.round(earned), 45);
  assert.deepEqual(
    statusManifest.phases.map((phase) => phase.tasks.reduce(
      (sum, task) => sum + (task.status === "complete" || task.status === "in_progress" ? task.earnedWeight : 0),
      0,
    )),
    [20, 19, 5.5],
  );

  for (const workstream of statusManifest.deliveryWorkstreams) {
    assert.equal(workstream.chunks.reduce((sum, chunk) => sum + chunk.share, 0), 100);
    assert.ok(workstream.chunks.every((chunk) => chunk.earnedShare >= 0 && chunk.earnedShare <= chunk.share));
    const derivedCompletion = workstream.chunks.reduce((sum, chunk) => sum + chunk.earnedShare, 0);
    assert.equal(workstream.completion, derivedCompletion);
    assert.equal(workstream.state, derivedCompletion === 100 ? "complete" : "in_progress");
  }

  const active = tasks.filter((task) => !task.deferred).reduce(
    (sum, task) => ({ min: sum.min + task.hoursRemaining.min, max: sum.max + task.hoursRemaining.max }),
    { min: 0, max: 0 },
  );
  const deferred = tasks.filter((task) => task.deferred).reduce(
    (sum, task) => ({ min: sum.min + task.hoursRemaining.min, max: sum.max + task.hoursRemaining.max }),
    { min: 0, max: 0 },
  );
  const soak = tasks.reduce(
    (sum, task) => ({ min: sum.min + (task.soakHours?.min ?? 0), max: sum.max + (task.soakHours?.max ?? 0) }),
    { min: 0, max: 0 },
  );
  assert.deepEqual(active, { min: 164, max: 301 });
  assert.deepEqual(deferred, { min: 84, max: 168 });
  assert.deepEqual(soak, { min: 48, max: 72 });
  assert.ok(Object.values(statusManifest.evidenceSources).every((url) => url.startsWith("https://")));
  assert.ok(statusManifest.liveChecks.every((check) => statusManifest.phases.some((phase) => phase.id === check.phaseId)));
});

test("status page renders the exact score, ETA boundaries, filters, and methodology", async () => {
  const response = await render("/status");
  const html = await response.text();
  const cleanHtml = html.replaceAll("<!-- -->", "");
  assert.match(cleanHtml, /45%/);
  assert.match(cleanHtml, /44\.5\s*\/\s*100/);
  assert.match(cleanHtml, /164[–-]301/);
  assert.match(cleanHtml, /External wait/);
  assert.match(cleanHtml, /Deferred/);
  assert.match(cleanHtml, /Every 6 hours and on demand/);
  assert.match(cleanHtml, /Every 60 seconds/);
  assert.match(cleanHtml, /One score, three accountable tracks/);
  assert.match(cleanHtml, /Exact parallel-agent progress/);
  assert.match(cleanHtml, /Persistent Project Ambient delivery status/);
  assert.match(cleanHtml, /Status bot/);
  assert.match(cleanHtml, /Project Ambient Status Bot/);
  assert.equal([...cleanHtml.matchAll(/data-status-dock-phase/g)].length, 3);
  assert.equal([...cleanHtml.matchAll(/data-status-dock-agent/g)].length, 4);
  assert.match(cleanHtml, /macos_build.*Godel/is);
  assert.match(cleanHtml, /mcp_build.*Lovelace/is);
  assert.match(cleanHtml, /site_build.*Curie/is);
  assert.match(cleanHtml, /primary.*Codex/is);
  assert.match(cleanHtml, /All/);
  assert.match(cleanHtml, /Active/);
  assert.match(cleanHtml, /Blocked/);
  assert.match(cleanHtml, /Deferred/);
  assert.match(cleanHtml, /Prepared is not approved/);
});

test("raw status manifest endpoint exposes the canonical machine-readable source", async () => {
  const response = await render("/status/manifest");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  const manifest = await response.json();
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.totalWeight, 100);
  assert.equal(manifest.phases.length, 3);
  assert.equal(manifest.deliveryWorkstreams.length, 4);
});

test("status API avoids recursive worker probes and unauthenticated GitHub API exhaustion", () => {
  assert.match(statusRouteSource, /project-ambient\.meekphillies\.chatgpt\.site\/favicon\.svg/);
  assert.match(statusRouteSource, /img\.shields\.io\/github\/actions\/workflow\/status/);
  assert.doesNotMatch(statusRouteSource, /probeUrl:\s*"https:\/\/project-ambient\.meekphillies\.chatgpt\.site"\s*,/);
  assert.doesNotMatch(statusRouteSource, /probeUrl:\s*"https:\/\/api\.github\.com/);
});
