# 2026-02-22 — GitHub Issues Automation Blueprint (Solo + AI Agents)

## Goal

Create a low-overhead, high-leverage GitHub-native workflow where Issues are the control plane, PRs are execution units, and AI agents handle repetitive triage/planning/review tasks while final decisions remain human-owned.

This blueprint is designed for Synapse’s current roadmap:

- M1 Reliability hardening
- M2 VS Code workflow excellence
- M3 Hybrid signal model
- M4 Team-suite monetization foundation

---

## Operating Model (Solo Developer)

### You own (manual decisions)

- Priority and sequencing
- Architectural tradeoffs
- Security-sensitive changes
- Merge and production deployment decisions
- Final issue closure validation

### AI agents own (automated assistance)

- Triage summaries and suggested labels
- Repro checklist generation
- Issue decomposition into sub-issues
- Draft PR scaffolding for approved issues
- Risk-oriented PR review summaries
- Changelog/release-note drafting

---

## Label + State Machine (Machine-Readable)

## Required labels

- Type: `type:bug`, `type:feature`, `type:hardening`, `type:docs`, `type:test`
- Area: `area:server`, `area:dashboard`, `area:vscode`, `area:analytics`, `area:platform`
- Priority: `priority:P0`, `priority:P1`, `priority:P2`, `priority:P3`
- Milestone: `milestone:M1`, `milestone:M2`, `milestone:M3`, `milestone:M4`
- Flow: `status:needs-triage`, `status:ready`, `status:blocked`, `status:in-progress`, `status:review`, `status:done`
- Agent control: `ai:triage`, `ai:plan`, `ai:implement`, `ai:review`

## Single-issue lifecycle

1. New issue created → `status:needs-triage`
2. Triage complete → `status:ready`
3. Work started → `status:in-progress`
4. PR opened → `status:review`
5. PR merged + deployed validated → `status:done` + close issue

---

## Event-to-Automation Map (GitHub Actions)

## Workflow A: Intake + Triage (`issues` opened/edited)

**Trigger**

- `issues: opened, edited, reopened`

**Automation**

- Validate issue template required fields (repro/env/expected/actual)
- Auto-apply default labels from issue form category
- AI Triage Agent posts:
  - severity hypothesis
  - likely subsystem
  - reproduction steps normalization
  - first investigation checklist
- If missing critical info, bot comments with checklist and applies `status:blocked`
- If complete, applies `status:ready`

**Manual step**

- You confirm final priority and milestone

---

## Workflow B: Planning Assistant (`issues` labeled with `ai:plan`)

**Trigger**

- Label `ai:plan` added

**Automation**

- AI Planner comments with:
  - root-cause hypotheses
  - implementation options (small/medium/large)
  - recommended approach
  - acceptance criteria draft
  - suggested sub-issues with dependency order
- Bot removes `ai:plan` and adds `status:ready`

**Manual step**

- You approve plan scope and split issues as needed

---

## Workflow C: Implementation Agent (`issues` labeled `ai:implement` + `status:ready`)

**Trigger**

- Label `ai:implement` added on ready issue

**Automation**

- Open a draft PR with:
  - branch name `issue-<id>-<slug>`
  - linked issue in PR body
  - checklist from acceptance criteria
- Run CI immediately
- Post PR link back to issue; set `status:in-progress`

**Manual step**

- You review changes, request edits, or close draft PR

---

## Workflow D: PR QA + Risk Review (`pull_request` opened/synchronize)

**Trigger**

- `pull_request: opened, synchronize, reopened`

**Automation**

- Run CI (`typecheck`, `lint`, `test`, `build`) using existing workflow
- AI Reviewer comments:
  - changed-surface summary
  - risk hotspots
  - missing tests or edge cases
  - rollback considerations
- If checks fail, set issue/PR metadata to `status:blocked`

**Manual step**

- You decide whether the PR is ready to merge

---

## Workflow E: Merge + Release Notes (`pull_request` closed on `main`)

**Trigger**

- PR merged to `main`

**Automation**

- Update linked issue:
  - comment “merged in <sha>”
  - move to deployment validation checklist
- Append release draft/changelog entry
- If auto-deploy exists, post deployment status back to issue

**Manual step**

- You validate in target environment and close issue only after real verification

---

## Workflow F: Regression Watchdog (`workflow_run` failure on `main`)

**Trigger**

- CI failure on `main`

**Automation**

- Create/update a single open “main branch regression” issue
- Attach failed run, failing test summary, first-seen timestamp
- Apply `priority:P0`, `type:bug`, `status:ready`

**Manual step**

- You decide immediate rollback vs forward fix

---

## Workflow G: Weekly Solo Triage Digest (`schedule`)

**Trigger**

- Cron weekly (e.g., Monday morning)

**Automation**

- AI summary comment or issue containing:
  - new issues this week
  - blocked issues with missing info
  - oldest P1/P2 issues
  - cycle-time and reopen-rate snapshot
  - suggested top-5 priorities

**Manual step**

- You pick next sprint priorities and close/defer noise

---

## Minimal Workflow Files to Add

Create these workflow files:

- `.github/workflows/issues-triage.yml`
- `.github/workflows/issues-plan.yml`
- `.github/workflows/issues-implement.yml`
- `.github/workflows/pr-ai-review.yml`
- `.github/workflows/release-note-issue-sync.yml`
- `.github/workflows/regression-watchdog.yml`
- `.github/workflows/weekly-triage-digest.yml`

Keep existing CI (`.github/workflows/ci.yml`) as the required merge gate.

---

## Issue Templates (Strongly Recommended)

Set up Issue Forms for:

1. Bug report
2. Reliability regression
3. Feature request
4. Tech debt

Required fields for bug form:

- Environment (OS, branch, version)
- Reproduction steps
- Expected vs actual
- Logs/screenshots
- Affected area (`server/dashboard/vscode/...`)

This allows deterministic automation rules and better AI triage quality.

---

## Branch + PR Policy (Solo-Friendly)

- Protect `main`
- Require passing checks (`typecheck`, `lint`, `test`, `build`)
- Require linked issue in PR body
- Use merge queue only if PR volume increases
- Keep PRs small (target 1 issue = 1 PR)

---

## Human-in-the-Loop Guardrails

AI should never auto-merge by default for this project stage.
Require your explicit approval for:

- schema/migration changes
- auth/security changes
- deployment/environment config changes
- high-blast-radius refactors

---

## Suggested AI Prompts by Role

## Triage Agent prompt skeleton

- “Classify severity and likely subsystem for this issue. Identify missing repro details. Propose first 5 investigation steps. Keep output actionable.”

## Planner Agent prompt skeleton

- “Propose a minimal root-cause-first implementation plan with acceptance criteria and tests. Include risks and rollback path.”

## Reviewer Agent prompt skeleton

- “Summarize changes, highlight risk hotspots, identify missing tests, and suggest targeted verification steps.”

---

## Rollout Plan (Do This Incrementally)

### Phase 1 (Week 1): Foundation

- Add issue templates
- Add labels/state machine
- Enable Intake + Triage automation
- Keep all implementation/review/deploy fully manual

### Phase 2 (Week 2): Planning + Review AI

- Enable `ai:plan` workflow
- Enable PR AI review comments
- Keep implementation agent optional

### Phase 3 (Week 3): Controlled implementation automation

- Enable `ai:implement` draft PR generation for low-risk issues only
- Add regression watchdog

### Phase 4 (Week 4): Cadence automation

- Enable weekly triage digest
- Tune label rules and triage prompts based on false positives

---

## Success Metrics (Track Monthly)

- Triage latency: issue opened → `status:ready`
- Lead time: issue ready → merged
- Change failure rate: merged PRs causing regressions
- Reopen rate: closed issues reopened
- Automation hit rate: % issues getting useful AI triage with no manual rewrite

---

## Practical “First 5 Automations” for Synapse

1. Issue intake validation + default labels
2. AI triage comment on new bugs
3. PR AI risk summary on every PR
4. Regression watchdog on `main` CI failures
5. Weekly triage digest issue

These five provide most value with low operational risk.

---

## Notes for Current Synapse Roadmap

- During M1 reliability, prioritize automation around bug triage, regression watchdog, and CI-linked issue updates.
- During M2 extension work, add area-specific auto-routing (`area:vscode`) and intervention-risk prompts.
- During M3/M4, expand automation to anomaly-related issue categorization and team-suite release-note generation.
