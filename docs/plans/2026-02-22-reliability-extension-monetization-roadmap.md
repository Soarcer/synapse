# 2026-02-22 — Reliability → VS Code → Team Monetization Roadmap

## Problem Statement

Synapse has strong feature depth and differentiation, but near-term success depends on sequencing execution to maximize trust and adoption:

1. Reliability must be production-grade before expansion
2. VS Code must become the best daily workflow surface
3. Signal quality must rise as event volume scales
4. Team monetization must ship on top of stable foundations

Without explicit milestone gates and scope controls, the project risks shipping breadth over durability.

## Proposed Approach

Use a gated, 8-week sequence with objective exit criteria:

- **Gate 1:** Reliability SLOs and long-session stability
- **Gate 2:** VS Code v1 workflow polish (startup + sync + intervention)
- **Gate 3:** Hybrid signal model (high-signal defaults, user override)
- **Gate 4:** Team-suite monetization foundation

### Locked Product Decisions

- **Reliability-first sequencing:** team suite ships only after reliability + VS Code gates
- **SLO baseline:** p95 event-to-render < 800ms, reconnect < 5s, 4-hour stable session target
- **VS Code v1 priorities:** zero-config startup, cross-panel coherence, intervention controls
- **Signal strategy:** hybrid prioritization
- **Monetization direction:** full team suite after reliability gates

---

## Milestone Backlog (8 Weeks)

## Milestone 1 (Weeks 1-3): Reliability Hardening + SLO Instrumentation

### Objectives

- Make ingestion/render pipeline resilient under sustained event load
- Establish measurable performance, reconnect, and stability baselines
- Reduce event integrity issues (duplicates, out-of-order, malformed payloads)

### Scope

- Add end-to-end latency instrumentation (`ingest_ts`, `broadcast_ts`, `render_ts`)
- Implement event quality classification (`valid`, `degraded`, `dropped`)
- Add dedupe keys and ordering safeguards at store boundary
- Add reconnect/backfill reliability path for websocket interruptions
- Add long-session memory guardrails and bounded cache policies
- Add synthetic load and chaos scenarios (drop/duplication/reorder)

### Acceptance Criteria (Exit Gate)

- p95 event-to-render latency < 800ms under agreed synthetic load profile
- Reconnect + hydration successful within < 5s in 95% of interruption tests
- 4-hour soak test with no fatal crashes and no unbounded memory growth
- Event loss rate and duplicate rate reported and within agreed threshold
- Reliability dashboard/log outputs available for quick regression checks

### Deliverables

- Instrumentation schema and collector hooks
- Reliability test suite + soak scripts
- Incident playbook for startup, reconnect, and hydration failures

---

## Milestone 2 (Weeks 3-5): VS Code v1 Workflow Excellence

### Objectives

- Make extension behavior predictable and frictionless for daily users
- Ensure all primary surfaces remain consistent in near-real-time
- Provide safe intervention controls without UX ambiguity

### Scope

- Zero-config startup hardening (server start + hook validation + hydration)
- Cross-panel sync guarantees (sidebar, graph panel, tree view)
- Intervention commands in extension (stop/reroute/escalate primitives)
- Better failure messaging for unavailable server, hook mismatch, stale hydration
- Persist/recover extension state during window reload/restart

### Acceptance Criteria (Exit Gate)

- First-time setup to visible events in < 2 minutes for clean workspace path
- Selection/state sync latency across panels appears instant to user (target < 300ms)
- Intervention commands complete with visible confirmation and audit event
- No unresolved stale-state bugs across extension reload scenarios in test matrix

### Deliverables

- VS Code v1 workflow checklist
- Extension reliability test matrix (startup/sync/intervention/recovery)
- Updated extension troubleshooting guide

---

## Milestone 3 (Weeks 5-6): Hybrid Signal Prioritization

### Objectives

- Raise signal-to-noise ratio without removing user control
- Make anomalies and costly failures impossible to miss

### Scope

- Add anomaly scoring pipeline for events/sessions (rule-based v1)
- Add high-priority rail in UI (errors, stalls, cost spikes, retry storms)
- Add “mute/snooze/demote” controls so users can override system emphasis
- Provide explainability panel for why an item was highlighted

### Acceptance Criteria (Exit Gate)

- High-priority events surface within 1 second of detection
- Users can override prioritization without losing default recommendations
- Measurable reduction in time-to-detect for critical events in usability test runs

### Deliverables

- Prioritization rubric and scoring config
- Alert/event explainability UI
- Benchmark report: baseline vs hybrid model

---

## Milestone 4 (Weeks 7-8): Team Suite MVP Foundation (Monetization Entry)

### Objectives

- Establish the first sellable team-grade workflow on stable infrastructure
- Preserve solo-user value while enabling team governance capabilities

### Scope

- Workspace/team boundary model (org, project, role context)
- Shared session views with audit trail for interventions
- Team anomaly feed and acknowledgment workflow
- Basic policy controls (e.g., intervention permission boundaries)
- Team-level operational summary (session health, anomalies, intervention log)

### Acceptance Criteria (Exit Gate)

- Two users can collaboratively monitor and triage the same project session
- All intervention actions are auditable with actor, timestamp, and context
- Role boundaries enforced for restricted actions in MVP scope
- Demo-ready team workflow completes end-to-end with no manual DB edits

### Deliverables

- Team domain model and API contracts
- Minimal RBAC + audit trail implementation
- Team operations dashboard (MVP scope)

---

## “Do Not Build Yet” List (Scope Guardrails)

- Full multi-provider adapter expansion beyond MVP abstractions
- Deep billing engine with invoices/usage contracts
- Advanced workflow automation marketplace
- Non-essential visual overhauls and additional lens variants
- Complex onboarding systems beyond minimal first-run checklist

Rationale: these items are valuable but reduce probability of shipping reliability and extension excellence on time.

---

## Risks and Mitigations

- **Risk:** Reliability work expands indefinitely
  - **Mitigation:** lock SLO gates and stop at “good enough to ship” thresholds
- **Risk:** Extension and web app behavior diverges
  - **Mitigation:** single event contract tests + shared sync invariants
- **Risk:** Signal model creates false positives
  - **Mitigation:** hybrid model + user override + explainability
- **Risk:** Team suite starts too broad
  - **Mitigation:** MVP must center on shared triage + audit, not full enterprise surface

---

## Dependency Map

- M2 depends on M1 reliability instrumentation + reconnect correctness
- M3 depends on M1 event quality metadata and M2 stable extension UX paths
- M4 depends on M1-M3 for trustworthy alerts and intervention records

---

## Suggested Weekly Cadence

- **Monday:** lock sprint goals + acceptance criteria for current milestone
- **Midweek:** synthetic load checks + UX verification sessions
- **Friday:** gate review against explicit criteria; defer non-gate work

---

## Immediate Next Sprint Backlog (Start Here)

1. Add event lifecycle timestamps and trace IDs through ingest → broadcast → client apply
2. Implement reconnect/hydration resilience tests (including forced disconnects)
3. Create 4-hour soak script and memory/latency capture output
4. Define and track reliability dashboard metrics in CI-friendly output format
5. Freeze milestone scope and open a dedicated board grouped by gate criteria

---

## Success Definition (End of 8 Weeks)

Synapse is perceived as dependable in long-running real usage, best-in-class inside VS Code for daily agent monitoring/control, and ready to demo/sell as a team collaboration and governance product without sacrificing solo-user adoption.
