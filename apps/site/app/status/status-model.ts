import rawManifest from "./status-manifest.json";

export type TaskStatus = "complete" | "in_progress" | "blocked" | "not_started";
export type LiveState = "operational" | "degraded" | "unavailable" | "unknown";

export type StatusTask = {
  id: string;
  name: string;
  status: TaskStatus;
  weight: number;
  earnedWeight: number;
  hoursRemaining: { min: number; max: number };
  evidence: string;
  externalApproval?: boolean;
  externalWait?: string;
  blockedReason?: string;
  deferred?: boolean;
  soakHours?: { min: number; max: number };
  recurring?: boolean;
};

export type StatusPhase = {
  id: string;
  name: string;
  summary: string;
  weight: number;
  handsOnRemaining: { min: number; max: number };
  tasks: StatusTask[];
};

export type DeliveryChunk = {
  label: string;
  share: number;
  earnedShare: number;
  status: TaskStatus;
};

export type DeliveryWorkstream = {
  id: string;
  owner: string;
  name: string;
  detail: string;
  chunks: DeliveryChunk[];
};

export type StatusManifest = {
  schemaVersion: number;
  project: string;
  release: string;
  totalWeight: number;
  updatedAt: string;
  evidenceAsOf: string;
  lastVerifiedAt: string;
  refreshSeconds: number;
  fieldDefaults: {
    deferred: boolean;
    externalWait: null;
  };
  automation: {
    agent: string;
    skill: string;
    weightedAuditCadence: string;
    liveHealthCadence: string;
    publishRule: string;
  };
  headline: {
    label: string;
    alphaLaunchStatus: string;
  };
  methodology: {
    formula: string;
    statusCredit: Record<TaskStatus, string>;
    approvalRule: string;
    etaRule: string;
    timeRule: string;
    healthRule: string;
  };
  externalApproval: {
    timeEstimate: string;
    gates: string[];
  };
  evidenceSources: Record<string, string>;
  dependencies: Record<string, string[]>;
  liveChecks: Array<{ id: string; label: string; url: string; phaseId: string }>;
  deliveryWorkstreams: DeliveryWorkstream[];
  phases: StatusPhase[];
};

export type LiveCheck = {
  id: string;
  label: string;
  url: string;
  state: LiveState;
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string;
  checkedAt: string | null;
  phaseId: string;
};

export type LiveCheckResponse = {
  checkedAt: string;
  checks: LiveCheck[];
};

export const statusManifest = rawManifest as StatusManifest;

export function taskCredit(task: StatusTask): number {
  if (task.status === "complete") return task.weight;
  if (task.status === "in_progress") {
    return Math.min(task.weight, Math.max(0, task.earnedWeight));
  }
  return 0;
}

export function phaseCompletion(phase: StatusPhase): number {
  if (phase.weight <= 0) return 0;
  const earned = phase.tasks.reduce((sum, task) => sum + taskCredit(task), 0);
  return (earned / phase.weight) * 100;
}

export function workstreamCompletion(workstream: DeliveryWorkstream): number {
  const total = workstream.chunks.reduce((sum, chunk) => sum + chunk.share, 0);
  const earned = workstream.chunks.reduce(
    (sum, chunk) => sum + Math.min(chunk.share, Math.max(0, chunk.earnedShare)),
    0,
  );
  return total > 0 ? (earned / total) * 100 : 0;
}

export function calculateStatus(manifest: StatusManifest) {
  const tasks = manifest.phases.flatMap((phase) => phase.tasks);
  const totalWeight = manifest.phases.reduce((sum, phase) => sum + phase.weight, 0);
  const earnedWeight = tasks.reduce((sum, task) => sum + taskCredit(task), 0);
  const activeRemaining = tasks.filter((task) => !task.deferred).reduce(
    (hours, task) => ({
      min: hours.min + task.hoursRemaining.min,
      max: hours.max + task.hoursRemaining.max,
    }),
    { min: 0, max: 0 },
  );
  const deferredRemaining = tasks.filter((task) => task.deferred).reduce(
    (hours, task) => ({
      min: hours.min + task.hoursRemaining.min,
      max: hours.max + task.hoursRemaining.max,
    }),
    { min: 0, max: 0 },
  );
  const soakTime = tasks.reduce(
    (hours, task) => ({
      min: hours.min + (task.soakHours?.min ?? 0),
      max: hours.max + (task.soakHours?.max ?? 0),
    }),
    { min: 0, max: 0 },
  );

  return {
    totalWeight,
    earnedWeight,
    completion: totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0,
    activeRemaining,
    deferredRemaining,
    soakTime,
    taskCount: tasks.length,
    completedTaskCount: tasks.filter((task) => task.status === "complete").length,
  };
}

export function emptyLiveChecks(manifest: StatusManifest): LiveCheck[] {
  return manifest.liveChecks.map((check) => ({
    ...check,
    state: "unknown",
    httpStatus: null,
    latencyMs: null,
    detail: "Waiting for the first public check",
    checkedAt: null,
  }));
}
