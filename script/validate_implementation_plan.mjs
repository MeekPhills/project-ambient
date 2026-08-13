import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const plan = JSON.parse(await readFile(new URL("../docs/product/implementation-plan.json", import.meta.url), "utf8"));
const statusManifest = JSON.parse(await readFile(new URL("../apps/site/app/status/status-manifest.json", import.meta.url), "utf8"));
const required = ["id", "milestone", "statusWeight", "size", "owner", "branch", "parallelGroup", "dependencies", "areas", "acceptance", "verification"];
const tasks = new Map();

assert.equal(plan.schemaVersion, 1);
assert.deepEqual(Object.values(plan.approvedMilestoneWeights), [8, 14, 12, 20, 14, 12, 7, 6, 7]);
assert.equal(Object.values(plan.approvedMilestoneWeights).reduce((sum, weight) => sum + weight, 0), 100);

for (const task of plan.tasks) {
  for (const field of required) assert.ok(task[field] !== undefined, `${task.id ?? "task"} missing ${field}`);
  assert.match(task.id, /^m[0-8]-[a-z0-9-]+$/);
  assert.ok(!tasks.has(task.id), `duplicate task ${task.id}`);
  assert.ok(["S", "M", "L"].includes(task.size), `${task.id} has invalid size`);
  assert.ok(task.statusWeight > 0, `${task.id} must have positive weight`);
  assert.ok(task.areas.length > 0 && task.acceptance.length > 0 && task.verification.length > 0, `${task.id} has an empty execution contract`);
  tasks.set(task.id, task);
}

for (const task of tasks.values()) {
  for (const dependency of task.dependencies) assert.ok(tasks.has(dependency), `${task.id} has unknown dependency ${dependency}`);
}

const visiting = new Set();
const visited = new Set();
function visit(id) {
  if (visited.has(id)) return;
  assert.ok(!visiting.has(id), `dependency cycle at ${id}`);
  visiting.add(id);
  for (const dependency of tasks.get(id).dependencies) visit(dependency);
  visiting.delete(id);
  visited.add(id);
}
for (const id of tasks.keys()) visit(id);

for (const [milestone, expected] of Object.entries(plan.approvedMilestoneWeights)) {
  const actual = plan.tasks.filter((task) => task.milestone === milestone).reduce((sum, task) => sum + task.statusWeight, 0);
  assert.equal(actual, expected, `${milestone} weights sum to ${actual}, expected ${expected}`);
}

assert.equal(statusManifest.schemaVersion, 3);
assert.deepEqual(Object.fromEntries(statusManifest.phases.map((phase) => [phase.id, phase.weight])), plan.approvedMilestoneWeights);
assert.deepEqual(
  new Set(statusManifest.phases.flatMap((phase) => phase.tasks.map((task) => task.id))),
  new Set(plan.tasks.map((task) => task.id)),
  "implementation plan and canonical manifest must contain the same task IDs",
);
for (const task of plan.tasks) {
  const statusTask = statusManifest.phases.flatMap((phase) => phase.tasks).find((candidate) => candidate.id === task.id);
  assert.equal(statusTask.weight, task.statusWeight, `${task.id} weight differs between plan and manifest`);
}
assert.equal(statusManifest.scoreHistory.at(-1).score, 49.75);
assert.match(statusManifest.scoreHistory.at(-1).reason, /not a second current score/i);

for (const id of plan.firstVerticalSlice) assert.ok(tasks.has(id), `unknown vertical-slice task ${id}`);
for (let index = 1; index < plan.firstVerticalSlice.length; index += 1) {
  const previous = plan.firstVerticalSlice[index - 1];
  const current = tasks.get(plan.firstVerticalSlice[index]);
  assert.ok(current.dependencies.includes(previous), `${current.id} must directly depend on ${previous}`);
}

const groups = Map.groupBy(plan.tasks, (task) => task.parallelGroup);
for (const [group, members] of groups) {
  if (group === "accepted-baseline") continue;
  const claimed = new Map();
  for (const task of members) {
    for (const area of task.areas) {
      assert.ok(!claimed.has(area), `${group} assigns ${area} to both ${claimed.get(area)} and ${task.id}`);
      claimed.set(area, task.id);
    }
  }
}

console.log(`implementation plan valid: ${tasks.size} tasks, 9 milestones, 100 points, acyclic dependencies`);
