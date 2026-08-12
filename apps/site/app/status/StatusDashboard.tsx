"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateStatus,
  emptyLiveChecks,
  phaseCompletion,
  statusManifest,
  taskCredit,
  workstreamCompletion,
  type LiveCheck,
  type LiveCheckResponse,
  type StatusTask,
  type TaskStatus,
} from "./status-model";

type TaskFilter = "all" | "active" | "blocked" | "deferred";
type FetchState = "idle" | "checking" | "current" | "error";

const statusCopy: Record<TaskStatus, { label: string; mark: string }> = {
  complete: { label: "Complete", mark: "✓" },
  in_progress: { label: "In progress", mark: "↗" },
  blocked: { label: "Blocked", mark: "!" },
  not_started: { label: "Not started", mark: "○" },
};

const filters: Array<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "blocked", label: "Blocked" },
  { id: "deferred", label: "Deferred" },
];

function formatTimestamp(value: string | null) {
  if (!value) return "Waiting for first check";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function taskMatchesFilter(task: StatusTask, filter: TaskFilter) {
  if (filter === "all") return true;
  if (filter === "blocked") return task.status === "blocked";
  if (filter === "deferred") return task.deferred === true;
  return !task.deferred && (task.status === "in_progress" || task.status === "not_started");
}

export function StatusDashboard() {
  const snapshot = useMemo(() => calculateStatus(statusManifest), []);
  const [checks, setChecks] = useState<LiveCheck[]>(() => emptyLiveChecks(statusManifest));
  const [checksUpdatedAt, setChecksUpdatedAt] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(
    () => new Set(statusManifest.phases.map((phase) => phase.id)),
  );
  const previousFailures = useRef<Set<string>>(new Set());

  const refreshChecks = useCallback(async () => {
    setFetchState("checking");
    try {
      const response = await fetch("/api/status", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Status endpoint returned ${response.status}`);
      const data = await response.json() as LiveCheckResponse;
      if (!Array.isArray(data.checks)) throw new Error("Status response did not contain checks");
      setChecks(data.checks);
      setChecksUpdatedAt(data.checkedAt);
      setFetchState("current");
    } catch {
      setFetchState("error");
    } finally {
      setNextRefreshAt(Date.now() + statusManifest.refreshSeconds * 1000);
    }
  }, []);

  useEffect(() => {
    const kickoffTimer = window.setTimeout(() => void refreshChecks(), 0);
    const refreshTimer = window.setInterval(
      () => void refreshChecks(),
      statusManifest.refreshSeconds * 1000,
    );
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(kickoffTimer);
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refreshChecks]);

  useEffect(() => {
    const currentFailures = new Set(
      checks
        .filter((check) => check.state === "degraded" || check.state === "unavailable")
        .map((check) => check.id),
    );
    const newlyFailing = checks.filter(
      (check) => currentFailures.has(check.id) && !previousFailures.current.has(check.id),
    );
    if (newlyFailing.length > 0) {
      setExpandedPhases((current) => {
        const next = new Set(current);
        newlyFailing.forEach((check) => next.add(check.phaseId));
        return next;
      });
    }
    previousFailures.current = currentFailures;
  }, [checks]);

  const filterCounts = useMemo(() => {
    const tasks = statusManifest.phases.flatMap((phase) => phase.tasks);
    return {
      all: tasks.length,
      active: tasks.filter((task) => taskMatchesFilter(task, "active")).length,
      blocked: tasks.filter((task) => taskMatchesFilter(task, "blocked")).length,
      deferred: tasks.filter((task) => taskMatchesFilter(task, "deferred")).length,
    };
  }, []);

  const failingChecks = checks.filter((check) => check.state === "degraded" || check.state === "unavailable");
  const operationalChecks = checks.filter((check) => check.state === "operational").length;
  const secondsToRefresh = nextRefreshAt && now
    ? Math.max(0, Math.ceil((nextRefreshAt - now) / 1000))
    : statusManifest.refreshSeconds;
  const roundedCompletion = Math.round(snapshot.completion);

  function setPhaseOpen(phaseId: string, open: boolean) {
    setExpandedPhases((current) => {
      if (current.has(phaseId) === open) return current;
      const next = new Set(current);
      if (open) next.add(phaseId);
      else next.delete(phaseId);
      return next;
    });
  }

  function chooseFilter(nextFilter: TaskFilter) {
    setFilter(nextFilter);
    setExpandedPhases((current) => {
      const next = new Set(current);
      statusManifest.phases.forEach((phase) => {
        if (phase.tasks.some((task) => taskMatchesFilter(task, nextFilter))) next.add(phase.id);
      });
      return next;
    });
  }

  return (
    <main id="main-content" className="status-main">
      <section className="status-hero" aria-labelledby="status-title">
        <div className="status-grid-lines" aria-hidden="true" />
        <div className="container status-hero-grid">
          <div className="status-hero-copy">
            <p className="eyebrow"><span /> Public alpha live · production work continues</p>
            <h1 id="status-title">Delivery, without the hand-waving.</h1>
            <p>
              Project Ambient is launched as an alpha. This page measures the
              harder question: how close the full initiative is to production
              readiness, marketplace distribution, and repeatable growth.
            </p>
            <div className="status-hero-meta">
              <span>Release {statusManifest.release}</span>
              <span>Evidence as of <time dateTime={statusManifest.evidenceAsOf}>{formatTimestamp(statusManifest.evidenceAsOf)}</time></span>
              <span>Audit automation · {statusManifest.automation.weightedAuditCadence}</span>
              <a href="/status/manifest">View raw manifest ↗</a>
            </div>
          </div>
          <div className="total-status-card">
            <div className="total-status-head">
              <span>Total readiness</span>
              <strong>{roundedCompletion}%</strong>
            </div>
            <div
              className="total-progress-bar"
            role="progressbar"
            aria-label="Overall weighted production readiness"
            aria-valuemin={0}
            aria-valuemax={100}
              aria-valuenow={snapshot.completion}
              aria-valuetext={`${formatPoints(snapshot.earnedWeight)} of ${snapshot.totalWeight} weighted points`}
            >
              {statusManifest.phases.map((phase) => {
                const completion = phaseCompletion(phase);
                return (
                  <span
                    className={`total-phase-segment segment-${phase.id}`}
                    style={{ width: `${phase.weight}%` }}
                    title={`${phase.name}: ${formatPercent(completion)}`}
                    aria-hidden="true"
                    key={phase.id}
                  >
                    <i style={{ width: `${completion}%` }} />
                  </span>
                );
              })}
            </div>
            <div className="total-status-legend">
              {statusManifest.phases.map((phase) => (
                <span key={phase.id}><i className={`legend-${phase.id}`} />{phase.name}<b>{formatPoints(phase.tasks.reduce((sum, task) => sum + taskCredit(task), 0))}/{phase.weight}</b></span>
              ))}
            </div>
            <p>Exact score {formatPoints(snapshot.earnedWeight)} of {snapshot.totalWeight}; headline rounded only for scanning.</p>
          </div>
        </div>
      </section>

      <section className="status-overview" aria-labelledby="overview-title">
        <div className="container">
          <div className="compact-status-facts" aria-label="Readiness boundaries">
            <span><small>Hands-on</small><b>{snapshot.activeRemaining.min}–{snapshot.activeRemaining.max}h</b></span>
            <span><small>External wait</small><b>{statusManifest.externalApproval.timeEstimate}</b></span>
            <span><small>QA soak</small><b>{snapshot.soakTime.min}–{snapshot.soakTime.max}h</b></span>
            <span><small>Deferred</small><b>{snapshot.deferredRemaining.min}–{snapshot.deferredRemaining.max}h</b></span>
            <span><small>Alpha</small><b className="fact-complete">{statusManifest.headline.alphaLaunchStatus}</b></span>
          </div>

          <div className="progress-groups">
            <article className="progress-group">
              <div className="progress-group-head">
                <div><p className="kicker">Three phases</p><h2 id="overview-title">One score, three accountable tracks.</h2></div>
                <p>Each chunk is one weighted task. Color shows state; the inner fill shows earned credit.</p>
              </div>
              <div className="compact-progress-list">
                {statusManifest.phases.map((phase, index) => {
                  const completion = phaseCompletion(phase);
                  const earned = phase.tasks.reduce((sum, task) => sum + taskCredit(task), 0);
                  return (
                    <div className="compact-progress-row" key={phase.id}>
                      <span className="compact-progress-index">0{index + 1}</span>
                      <div className="compact-progress-label"><strong>{phase.name}</strong><small>{formatPoints(earned)} / {phase.weight} pts</small></div>
                      <div
                        className="horizontal-chunk-bar"
                        role="progressbar"
                        aria-label={`${phase.name} weighted completion`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={completion}
                        aria-valuetext={`${formatPoints(earned)} of ${phase.weight} points`}
                      >
                        {phase.tasks.map((task) => (
                          <span
                            className={`bar-chunk chunk-${task.status}${task.deferred ? " chunk-deferred" : ""}`}
                            style={{ width: `${(task.weight / phase.weight) * 100}%` }}
                            title={`${task.name}: ${formatPoints(taskCredit(task))}/${task.weight}`}
                            aria-hidden="true"
                            key={task.id}
                          >
                            <i style={{ width: `${(taskCredit(task) / task.weight) * 100}%` }} />
                          </span>
                        ))}
                      </div>
                      <strong className="compact-progress-value">{formatPercent(completion)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="chunk-legend" aria-label="Bar color legend">
                <span><i className="legend-complete" />Complete</span><span><i className="legend-active" />Earned / active</span><span><i className="legend-blocked" />Blocked</span><span><i className="legend-remaining" />Remaining</span>
              </div>
            </article>

            <article className="progress-group owner-progress-group">
              <div className="progress-group-head">
                <div><p className="kicker">Four ongoing steps</p><h2>Exact parallel-agent progress.</h2></div>
                <p>Percentages are the sum of named delivery chunks, not subjective activity estimates.</p>
              </div>
              <div className="compact-progress-list">
                {statusManifest.deliveryWorkstreams.map((workstream, index) => {
                  const completion = workstreamCompletion(workstream);
                  return (
                    <div className="compact-progress-row workstream-row" key={workstream.id}>
                      <span className="compact-progress-index">0{index + 1}</span>
                      <div className="compact-progress-label"><strong>{workstream.name}</strong><small>{workstream.owner}</small></div>
                      <div
                        className="horizontal-chunk-bar"
                        role="progressbar"
                        aria-label={`${workstream.name} delivery progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={completion}
                        aria-valuetext={`${formatPercent(completion)}; ${workstream.detail}`}
                      >
                        {workstream.chunks.map((chunk) => (
                          <span
                            className={`bar-chunk chunk-${chunk.status}`}
                            style={{ width: `${chunk.share}%` }}
                            title={`${chunk.label}: ${chunk.earnedShare}/${chunk.share}`}
                            aria-hidden="true"
                            key={chunk.label}
                          >
                            <i style={{ width: `${(chunk.earnedShare / chunk.share) * 100}%` }} />
                          </span>
                        ))}
                      </div>
                      <strong className="compact-progress-value">{formatPercent(completion)}</strong>
                    </div>
                  );
                })}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="status-live section-pad" aria-labelledby="live-title">
        <div className="container">
          <div className="status-section-heading">
            <div>
              <p className="kicker">Public guardrails</p>
              <h2 id="live-title">Live surfaces, checked every minute.</h2>
            </div>
            <div className="live-refresh-panel" aria-live="polite">
              <div>
                <strong className={failingChecks.length ? "live-summary degraded" : "live-summary"}>
                  <i aria-hidden="true" />
                  {fetchState === "error"
                    ? "Live refresh unavailable"
                    : failingChecks.length
                      ? `${failingChecks.length} check${failingChecks.length === 1 ? "" : "s"} need attention`
                      : `${operationalChecks} of ${checks.length} checks operational`}
                </strong>
                <span>
                  {checksUpdatedAt ? `Checked ${formatTimestamp(checksUpdatedAt)}` : "Using manifest fallback while checks start"}
                  {fetchState !== "checking" ? ` · refresh in ${secondsToRefresh}s` : " · checking now"}
                </span>
              </div>
              <button type="button" onClick={() => void refreshChecks()} disabled={fetchState === "checking"}>
                {fetchState === "checking" ? "Checking…" : "Check now"}
              </button>
            </div>
          </div>
          <p className="health-boundary">Health checks report public availability only. They never add to—or subtract from—the weighted delivery score.</p>
          <div className="live-check-grid">
            {checks.map((check) => (
              <a className={`live-check-card state-${check.state}`} href={check.url} target="_blank" rel="noreferrer" key={check.id}>
                <span className="live-check-state"><i aria-hidden="true" /> {check.state === "unknown" ? "Checking" : check.state}</span>
                <h3>{check.label}<span aria-hidden="true">↗</span></h3>
                <p>{check.detail}</p>
                <small>{check.httpStatus ? `HTTP ${check.httpStatus}` : "No response yet"}{check.latencyMs !== null ? ` · ${check.latencyMs} ms` : ""}</small>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="status-phases section-pad" aria-labelledby="phases-title">
        <div className="container">
          <div className="status-section-heading phase-heading">
            <div>
              <p className="kicker">Weighted plan</p>
              <h2 id="phases-title">Every point has a job.</h2>
            </div>
            <p>{snapshot.taskCount} auditable tasks across a fixed {statusManifest.totalWeight}-point plan. Filters change the rows you see, never the score.</p>
          </div>

          <div className="task-filter" role="group" aria-label="Filter delivery tasks">
            {filters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? "active" : ""}
                aria-pressed={filter === item.id}
                onClick={() => chooseFilter(item.id)}
              >
                {item.label} <span>{filterCounts[item.id]}</span>
              </button>
            ))}
          </div>

          <div className="phase-list">
            {statusManifest.phases.map((phase, index) => {
              const visibleTasks = phase.tasks.filter((task) => taskMatchesFilter(task, filter));
              const earned = phase.tasks.reduce((sum, task) => sum + taskCredit(task), 0);
              const completion = phaseCompletion(phase);
              return (
                <details
                  className="phase-card"
                  open={expandedPhases.has(phase.id)}
                  onToggle={(event) => setPhaseOpen(phase.id, event.currentTarget.open)}
                  key={phase.id}
                >
                  <summary>
                    <span className="phase-index">0{index + 1}</span>
                    <span className="phase-title-block">
                      <strong>{phase.name}</strong>
                      <small>{phase.summary}</small>
                    </span>
                    <span className="phase-score"><b>{formatPoints(earned)} / {phase.weight}</b><small>{Math.round(completion)}%</small></span>
                    <span className="phase-toggle" aria-hidden="true">+</span>
                  </summary>
                  <div className="phase-progress" role="progressbar" aria-label={`${phase.name} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(completion)}>
                    <span style={{ width: `${completion}%` }} />
                  </div>
                  <div className="phase-body">
                    <div className="phase-body-meta">
                      <span>Weight {phase.weight} pts</span>
                      <span>Hands-on remaining {phase.handsOnRemaining.min}–{phase.handsOnRemaining.max}h</span>
                      <span>{phase.tasks.length} tasks</span>
                    </div>
                    {visibleTasks.length ? (
                      <div className="task-table" role="table" aria-label={`${phase.name} delivery tasks`}>
                        <div className="task-row task-row-head" role="row">
                          <span role="columnheader">Task and evidence</span><span role="columnheader">State</span><span role="columnheader">Credit</span><span role="columnheader">Hands-on</span>
                        </div>
                        {visibleTasks.map((task) => {
                          const copy = statusCopy[task.status];
                          const dependencies = statusManifest.dependencies[task.id] ?? [];
                          return (
                            <div className={`task-row task-${task.status}${task.deferred ? " task-deferred" : ""}`} role="row" key={task.id}>
                              <div className="task-name" role="cell">
                                <strong>{task.name}</strong>
                                <p>{task.evidence}</p>
                                {task.blockedReason ? <small className="task-blocker"><b>Boundary:</b> {task.blockedReason}</small> : null}
                                {dependencies.length ? <small><b>Depends on:</b> {dependencies.join(" · ")}</small> : null}
                              </div>
                              <div role="cell"><span className={`task-status status-${task.status}`}><i aria-hidden="true">{copy.mark}</i>{copy.label}</span>{task.deferred ? <span className="task-flag">Deferred</span> : null}{task.externalApproval ? <span className="task-flag gate">External gate</span> : null}</div>
                              <div className="task-credit" role="cell"><strong>{formatPoints(taskCredit(task))}</strong><span>/ {task.weight} pts</span></div>
                              <div className="task-hours" role="cell">
                                {task.hoursRemaining.max > 0 ? <strong>{task.hoursRemaining.min}–{task.hoursRemaining.max}h</strong> : <strong>—</strong>}
                                {task.externalWait ? <span>Wait: {task.externalWait}</span> : null}
                                {task.soakHours ? <span>Plus {task.soakHours.min}–{task.soakHours.max}h soak</span> : null}
                                {task.recurring ? <span>Plus recurring ops</span> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="empty-filter">No {filter.replace("_", " ")} tasks in this phase.</p>}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </section>

      <section className="status-methodology section-pad" aria-labelledby="method-title">
        <div className="container methodology-grid">
          <div className="methodology-intro">
            <p className="kicker">Transparent methodology</p>
            <h2 id="method-title">The score can be rebuilt from the source.</h2>
            <p>{statusManifest.methodology.formula}</p>
            <a className="button button-primary" href="/status/manifest">Open machine-readable manifest ↗</a>
          </div>
          <div className="methodology-cards">
            <article>
              <span>01 · Credit</span>
              <h3>Status is not a vibe.</h3>
              <ul>{Object.entries(statusManifest.methodology.statusCredit).map(([status, rule]) => <li key={status}><b>{status.replace("_", " ")}</b>{rule}</li>)}</ul>
            </article>
            <article>
              <span>02 · Approval gates</span>
              <h3>Prepared is not approved.</h3>
              <p>{statusManifest.methodology.approvalRule}</p>
              <strong className="unknown-time">External wait: {statusManifest.externalApproval.timeEstimate}</strong>
            </article>
            <article>
              <span>03 · Time</span>
              <h3>Three clocks, kept separate.</h3>
              <p>{statusManifest.methodology.etaRule}</p>
              <p>{statusManifest.methodology.timeRule}</p>
            </article>
            <article>
              <span>04 · Evidence</span>
              <h3>Public where it can be.</h3>
              <p>Task weights and dependencies live in schema v{statusManifest.schemaVersion}. Public checks use no private token and never alter progress.</p>
              <div className="automation-note" aria-label="Status automation policy">
                <b>{statusManifest.automation.agent}</b>
                <span>Skill: {statusManifest.automation.skill}</span>
                <span>Weighted audit: {statusManifest.automation.weightedAuditCadence}</span>
                <span>Live health: {statusManifest.automation.liveHealthCadence}</span>
                <span>{statusManifest.automation.publishRule}</span>
              </div>
              <div className="evidence-links">
                {Object.entries(statusManifest.evidenceSources).slice(0, 7).map(([label, url]) => <a href={url} target="_blank" rel="noreferrer" key={label}>{label} ↗</a>)}
              </div>
            </article>
          </div>
        </div>
      </section>

      <aside className="running-status-dock" aria-label="Persistent Project Ambient delivery status">
        <div className="running-status-dock-inner">
          <div className="dock-total"><span><i aria-hidden="true" /> Status bot</span><strong>{roundedCompletion}%</strong></div>
          <div className="dock-phase-bars" aria-label="Three phase progress">
            {statusManifest.phases.map((phase, index) => {
              const completion = phaseCompletion(phase);
              return (
                <span aria-label={`${phase.name}: ${formatPercent(completion)}`} title={phase.name} key={phase.id}>
                  <small>0{index + 1}</small><i aria-hidden="true"><b style={{ width: `${completion}%` }} /></i><strong>{formatPercent(completion)}</strong>
                </span>
              );
            })}
          </div>
          <div className="dock-agent-bars" aria-label="Four parallel workstreams">
            {statusManifest.deliveryWorkstreams.map((workstream) => {
              const completion = workstreamCompletion(workstream);
              const owner = workstream.owner.split("·").at(-1)?.trim() ?? workstream.owner;
              return <span aria-label={`${workstream.name}, ${owner}: ${formatPercent(completion)}`} title={workstream.name} key={workstream.id}><i aria-hidden="true"><b style={{ width: `${completion}%` }} /></i><strong>{owner}</strong><small>{formatPercent(completion)}</small></span>;
            })}
          </div>
          <a href="#phases-title">Tasks <span aria-hidden="true">↑</span></a>
        </div>
      </aside>
    </main>
  );
}
