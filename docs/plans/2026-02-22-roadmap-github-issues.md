# 2026-02-22 — GitHub Issues Backlog (Reliability → VS Code → Team Suite)

Use this file to create GitHub issues directly.
Recommended labels:

- `area:server`, `area:dashboard`, `area:vscode`, `area:analytics`, `area:platform`
- `type:feature`, `type:hardening`, `type:test`, `type:docs`
- `priority:P0`, `priority:P1`, `priority:P2`
- `milestone:M1`, `milestone:M2`, `milestone:M3`, `milestone:M4`

---

## Milestone M1 (Weeks 1-3): Reliability Hardening + SLO Instrumentation

## Issue 1: Add end-to-end event tracing timestamps and trace IDs

- **Labels:** `milestone:M1`, `priority:P0`, `area:server`, `area:dashboard`, `type:feature`
- **Problem:** We cannot reliably compute true ingest-to-render latency.
- **Scope:** Add `traceId`, `ingestTs`, `broadcastTs`, `clientReceivedTs`, `clientAppliedTs` through pipeline.
- **Acceptance Criteria:**
  - Each event has trace metadata from ingest through client apply.
  - p50/p95/p99 latency can be computed from logs or metrics endpoint.
  - No regression in existing event rendering flow.

## Issue 2: Implement event quality classification at ingest boundary

- **Labels:** `milestone:M1`, `priority:P0`, `area:server`, `type:hardening`
- **Problem:** Malformed/duplicate/out-of-order events are not consistently tagged.
- **Scope:** Add quality states (`valid`, `degraded`, `dropped`) and reason codes.
- **Acceptance Criteria:**
  - All ingested events receive a quality classification.
  - Drop/degrade counts are queryable in diagnostics.
  - Quality reasons are visible in server logs.

## Issue 3: Add deterministic dedupe and ordering safeguards

- **Labels:** `milestone:M1`, `priority:P0`, `area:server`, `area:platform`, `type:hardening`
- **Problem:** Duplicate or out-of-order events can cause misleading graph state.
- **Scope:** Introduce dedupe keys and ordering window per session/agent.
- **Acceptance Criteria:**
  - Duplicate events do not create duplicate graph artifacts.
  - Out-of-order events are reconciled within defined tolerance.
  - Behavior covered by tests for duplicates/reordering/retry storms.

## Issue 4: Harden websocket reconnect and hydration correctness

- **Labels:** `milestone:M1`, `priority:P0`, `area:dashboard`, `area:vscode`, `type:hardening`
- **Problem:** Interruption recovery can produce stale or partial UI state.
- **Scope:** Improve reconnect backoff, hydration merge strategy, stale-state detection.
- **Acceptance Criteria:**
  - Reconnect + hydration succeeds in <5s for 95% of forced disconnect tests.
  - No duplicated nodes after reconnect.
  - Extension and browser modes recover consistently.

## Issue 5: Add 4-hour soak test harness and report output

- **Labels:** `milestone:M1`, `priority:P0`, `area:platform`, `type:test`
- **Problem:** Long-session stability is not continuously validated.
- **Scope:** Create soak script, memory/latency snapshots, pass/fail thresholds.
- **Acceptance Criteria:**
  - Soak test runs 4h without fatal crash.
  - Memory growth remains bounded per agreed threshold.
  - Report artifact produced for CI/manual review.

## Issue 6: Reliability dashboard/metrics endpoint for gate checks

- **Labels:** `milestone:M1`, `priority:P1`, `area:server`, `type:feature`
- **Problem:** Gate status cannot be verified quickly by contributors.
- **Scope:** Add health metrics endpoint/log summary for SLO indicators.
- **Acceptance Criteria:**
  - Endpoint or structured output includes p95 latency, reconnect SLA, event quality counts.
  - Gate checks can be performed in under 5 minutes.

---

## Milestone M2 (Weeks 3-5): VS Code v1 Workflow Excellence

## Issue 7: Zero-config startup reliability pass

- **Labels:** `milestone:M2`, `priority:P0`, `area:vscode`, `type:hardening`
- **Problem:** Startup, hook validation, and hydration are not always frictionless.
- **Scope:** Harden first-run flow for server start + hook checks + initial data load.
- **Acceptance Criteria:**
  - Clean workspace reaches live events in <2 minutes.
  - Clear failure prompts for hook/server issues.
  - Startup checklist documented.

## Issue 8: Guarantee cross-panel coherence contract

- **Labels:** `milestone:M2`, `priority:P0`, `area:vscode`, `type:feature`
- **Problem:** Sidebar, graph panel, and tree can drift.
- **Scope:** Define sync invariants and enforce via event-driven tests.
- **Acceptance Criteria:**
  - Node selection/state changes propagate across surfaces in <300ms target.
  - No stale selection after panel reload.
  - Contract tests cover key sync flows.

## Issue 9: Add intervention controls with explicit confirmations

- **Labels:** `milestone:M2`, `priority:P0`, `area:vscode`, `area:server`, `type:feature`
- **Problem:** Users need actionability, not only observability.
- **Scope:** Implement stop/reroute/escalate commands with confirmation and result feedback.
- **Acceptance Criteria:**
  - Commands execute successfully with visible success/error state.
  - Every intervention emits an auditable event.
  - No destructive action without explicit confirmation.

## Issue 10: Extension restart and reload state recovery

- **Labels:** `milestone:M2`, `priority:P1`, `area:vscode`, `type:hardening`
- **Problem:** Window reload can drop context and confuse users.
- **Scope:** Persist/recover minimal extension state and reconcile with fresh hydration.
- **Acceptance Criteria:**
  - On reload, extension restores to coherent state without manual reset.
  - No broken UI references after server reconnect.

## Issue 11: VS Code v1 troubleshooting and diagnostics docs

- **Labels:** `milestone:M2`, `priority:P2`, `area:vscode`, `type:docs`
- **Problem:** Operational debugging is slow for non-authors.
- **Scope:** Add doc for startup failures, hooks mismatch, stale hydration, intervention errors.
- **Acceptance Criteria:**
  - Top 5 failure modes documented with clear steps.
  - Linked from extension settings/help surface.

---

## Milestone M3 (Weeks 5-6): Hybrid Signal Prioritization

## Issue 12: Implement anomaly scoring engine v1 (rule-based)

- **Labels:** `milestone:M3`, `priority:P0`, `area:analytics`, `area:server`, `type:feature`
- **Problem:** Critical signals are buried in event volume.
- **Scope:** Build scoring for failures, stalls, cost spikes, retry storms.
- **Acceptance Criteria:**
  - Each candidate anomaly includes score + reason metadata.
  - Scoring is configurable by threshold.

## Issue 13: Add high-priority rail and alert emphasis UI

- **Labels:** `milestone:M3`, `priority:P0`, `area:dashboard`, `area:vscode`, `type:feature`
- **Problem:** Users need immediate visibility into important events.
- **Scope:** Introduce prioritized alert rail across primary surfaces.
- **Acceptance Criteria:**
  - Critical items surface within 1 second of detection.
  - Rail remains visible but non-blocking.

## Issue 14: Add user override controls (mute/snooze/demote)

- **Labels:** `milestone:M3`, `priority:P1`, `area:dashboard`, `type:feature`
- **Problem:** Fully automatic prioritization can create false-positive fatigue.
- **Scope:** Add override controls preserving system defaults.
- **Acceptance Criteria:**
  - Users can mute/snooze/demote without disabling anomaly system.
  - Overrides are reversible and scoped predictably.

## Issue 15: Explainability panel for highlighted events

- **Labels:** `milestone:M3`, `priority:P1`, `area:dashboard`, `type:feature`
- **Problem:** Users need trust in why something is highlighted.
- **Scope:** Show score drivers, contributing events, and threshold context.
- **Acceptance Criteria:**
  - Every highlighted item has an explanation view.
  - Explanation reflects actual scoring inputs.

---

## Milestone M4 (Weeks 7-8): Team Suite MVP Foundation

## Issue 16: Define team/workspace domain model and API contracts

- **Labels:** `milestone:M4`, `priority:P0`, `area:platform`, `type:feature`
- **Problem:** Team capabilities need explicit boundaries and ownership model.
- **Scope:** Add org/workspace/project context and contract docs.
- **Acceptance Criteria:**
  - Domain entities and lifecycle are documented and implemented.
  - API contracts reviewed and stable for MVP.

## Issue 17: Implement minimal RBAC for intervention actions

- **Labels:** `milestone:M4`, `priority:P0`, `area:server`, `area:vscode`, `type:feature`
- **Problem:** Team workflows require controlled action permissions.
- **Scope:** Restrict interventions by role for MVP.
- **Acceptance Criteria:**
  - Unauthorized actions are blocked and logged.
  - Role checks covered by tests.

## Issue 18: Add intervention audit trail and review view

- **Labels:** `milestone:M4`, `priority:P0`, `area:server`, `area:dashboard`, `type:feature`
- **Problem:** Team trust requires accountability on actions.
- **Scope:** Persist who did what/when/where for interventions.
- **Acceptance Criteria:**
  - Every intervention has actor, timestamp, target, outcome.
  - Review view supports filtering by workspace/session/user.

## Issue 19: Team anomaly triage workflow (acknowledge/assign/status)

- **Labels:** `milestone:M4`, `priority:P1`, `area:dashboard`, `type:feature`
- **Problem:** Teams need collaborative handling of high-priority issues.
- **Scope:** Add minimal triage loop for anomalies.
- **Acceptance Criteria:**
  - Teams can acknowledge and assign anomalies.
  - Status transitions are tracked in audit history.

## Issue 20: Team operations summary (MVP dashboard)

- **Labels:** `milestone:M4`, `priority:P1`, `area:analytics`, `type:feature`
- **Problem:** Team buyers need glanceable operational value.
- **Scope:** Add compact summary for session health, anomalies, interventions.
- **Acceptance Criteria:**
  - Summary view reflects current workspace data correctly.
  - Supports executive/demo walkthrough with no manual prep.

---

## Non-Goals (Do Not File in This Sequence)

- Full enterprise billing and invoicing engine
- Broad new lens families beyond current roadmap
- Marketplace/automation ecosystem expansion
- Cosmetic-only UI rewrites without gate impact

---

## Suggested Milestone Gate Checklist

- **M1 Gate:** SLO pass + soak pass + reconnect pass
- **M2 Gate:** setup friction pass + coherence pass + intervention pass
- **M3 Gate:** alert latency pass + explainability pass + override pass
- **M4 Gate:** RBAC pass + audit pass + collaborative triage pass
