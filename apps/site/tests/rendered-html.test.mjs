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
  assert.equal(statusManifest.schemaVersion, 3);
  assert.equal(statusManifest.totalWeight, 100);
  assert.equal(phaseWeight, statusManifest.totalWeight);
  assert.match(statusManifest.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(statusManifest.evidenceAsOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(statusManifest.automation.skill, "project-ambient-status");
  assert.equal(statusManifest.automation.agent, "Project Ambient Status Bot");
  assert.equal(statusManifest.automation.weightedAuditCadence, "Every 6 hours and on demand");
  assert.equal(statusManifest.automation.liveHealthCadence, "Every 60 seconds");
  assert.deepEqual(statusManifest.phases.map((phase) => phase.weight), [8, 14, 12, 20, 14, 12, 7, 6, 7]);
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
  assert.equal(earned, 15);
  assert.equal(Math.round(earned), 15);
  assert.deepEqual(
    statusManifest.phases.map((phase) => phase.tasks.reduce(
      (sum, task) => sum + (task.status === "complete" || task.status === "in_progress" ? task.earnedWeight : 0),
      0,
    )),
    [3, 5, 1, 0.5, 3, 0, 0, 0.5, 2],
  );

  for (const workstream of statusManifest.deliveryWorkstreams) {
    assert.equal(workstream.chunks.reduce((sum, chunk) => sum + chunk.share, 0), 100);
    assert.ok(workstream.chunks.every((chunk) => chunk.earnedShare >= 0 && chunk.earnedShare <= chunk.share));
    const derivedCompletion = workstream.chunks.reduce((sum, chunk) => sum + chunk.earnedShare, 0);
    assert.equal(workstream.completion, derivedCompletion);
    assert.equal(workstream.state, derivedCompletion === 100 ? "complete" : "in_progress");
  }
  assert.deepEqual(statusManifest.deliveryWorkstreams.map((workstream) => workstream.completion), [50, 0, 66, 20]);
  assert.match(statusManifest.deliveryWorkstreams[0].detail, /tracker migration/);
  assert.match(statusManifest.deliveryWorkstreams[2].detail, /Six of nine/);

  const active = tasks.filter((task) => !task.deferred).reduce(
    (sum, task) => ({ min: sum.min + task.hoursRemaining.min, max: sum.max + task.hoursRemaining.max }),
    { min: 0, max: 0 },
  );
  const deferred = statusManifest.deferredInitiatives.reduce(
    (sum, initiative) => ({ min: sum.min + initiative.hoursRemaining.min, max: sum.max + initiative.hoursRemaining.max }),
    { min: 0, max: 0 },
  );
  const soak = tasks.reduce(
    (sum, task) => ({ min: sum.min + (task.soakHours?.min ?? 0), max: sum.max + (task.soakHours?.max ?? 0) }),
    { min: 0, max: 0 },
  );
  assert.deepEqual(active, { min: 138, max: 259 });
  assert.deepEqual(deferred, { min: 84, max: 168 });
  assert.deepEqual(soak, { min: 48, max: 72 });
  assert.ok(Object.values(statusManifest.evidenceSources).every((url) => url.startsWith("https://")));
  assert.equal(statusManifest.migration.fromSchemaVersion, 2);
  assert.equal(statusManifest.migration.toSchemaVersion, 3);
  assert.equal(statusManifest.scoreHistory.length, 1);
  assert.equal(statusManifest.scoreHistory[0].score, 49.75);
  assert.deepEqual(statusManifest.scoreHistory[0].phaseWeights, [45, 45, 10]);
  assert.deepEqual(statusManifest.scoreHistory[0].phaseEarned, [24, 20.25, 5.5]);
  assert.match(statusManifest.scoreHistory[0].reason, /not a second current score/i);
  assert.equal(statusManifest.phases.length, 9);
  assert.ok(statusManifest.liveChecks.every((check) => statusManifest.phases.some((phase) => phase.id === check.phaseId)));
});

test("status page renders the exact score, ETA boundaries, filters, and methodology", async () => {
  const response = await render("/status");
  const html = await response.text();
  const cleanHtml = html.replaceAll("<!-- -->", "");
  assert.match(cleanHtml, /15%/);
  assert.match(cleanHtml, /15\s*\/\s*100/);
  assert.match(cleanHtml, /138[–-]259/);
  assert.match(cleanHtml, /External wait/);
  assert.match(cleanHtml, /Deferred/);
  assert.match(cleanHtml, /Every 6 hours and on demand/);
  assert.match(cleanHtml, /Every 60 seconds/);
  assert.match(cleanHtml, /One score, nine accountable gates/);
  assert.match(cleanHtml, /Exact parallel-agent progress/);
  assert.match(cleanHtml, /Persistent Project Ambient delivery status/);
  assert.match(cleanHtml, /Status bot/);
  assert.match(cleanHtml, /Project Ambient Status Bot/);
  assert.equal([...cleanHtml.matchAll(/data-status-dock-phase/g)].length, 9);
  assert.equal([...cleanHtml.matchAll(/data-status-dock-agent/g)].length, 4);
  for (const workstream of statusManifest.deliveryWorkstreams) {
    const [agent, model] = workstream.owner.split("·").map((part) => part.trim());
    assert.match(cleanHtml, new RegExp(`${agent}.*${model}`, "is"));
  }
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
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert.equal(cacheControl, "no-store, max-age=0");
  assert.doesNotMatch(cacheControl, /\b(?:public|s-maxage|stale-while-revalidate)\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const manifest = await response.json();
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.totalWeight, 100);
  assert.equal(manifest.phases.length, 9);
  assert.equal(manifest.deliveryWorkstreams.length, 4);
});

test("status API avoids recursive worker probes and unauthenticated GitHub API exhaustion", () => {
  assert.match(statusRouteSource, /project-ambient\.meekphillies\.chatgpt\.site\/cdn-cgi\/trace/);
  assert.match(statusRouteSource, /img\.shields\.io\/github\/actions\/workflow\/status/);
  assert.doesNotMatch(statusRouteSource, /probeUrl:\s*"https:\/\/project-ambient\.meekphillies\.chatgpt\.site"\s*,/);
  assert.doesNotMatch(statusRouteSource, /probeUrl:\s*"https:\/\/api\.github\.com/);
});
