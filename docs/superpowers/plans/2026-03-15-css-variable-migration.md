# CSS Variable Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded hex color values across the dashboard with Tailwind 4 `@theme` semantic tokens, enabling runtime theming and laying the foundation for AI self-modification.

**Architecture:** Add a `@theme` block to `index.css` defining 11 CSS custom properties. <!-- revised: header count corrected from 13 to 11 --> Tailwind 4 emits these as `:root` variables, so utility classes like `bg-syn-bg-primary` compile to `background-color: var(--color-syn-bg-primary)`. Runtime overrides simply inject a `<style>` tag after the stylesheet. A pre-React inline script in `index.html` prevents flash-of-default-theme on reload.

**Tech Stack:** Tailwind CSS 4, React 19, Vite 6. No new dependencies.

**Branch:** Create `feat/css-variable-migration` before starting. Keep separate from current working branch.

---

## Color Token Map

All hardcoded hex values found in the codebase and their semantic tokens:

| Hex       | Occurrences | Token                | Usage                          |
| --------- | ----------- | -------------------- | ------------------------------ |
| `#0d1117` | 59          | `syn-bg-primary`     | Main canvas / page background  |
| `#161b22` | 78          | `syn-bg-surface`     | Cards, panels, containers      |
| `#1c2128` | 17          | `syn-bg-elevated`    | Dropdowns, menus, popovers     |
| `#1c2333` | 2           | `syn-bg-overlay`     | Dialogs, modal overlays        |
| `#1a1d27` | 1           | `syn-bg-tool-group`  | Tool group node container      |
| `#30363d` | 15          | `syn-border-primary` | Primary dividers/borders       |
| `#21262d` | 5           | `syn-border-subtle`  | Subtle borders, row separators |
| `#484f58` | 2           | `syn-border-muted`   | Muted borders, footer text     |
| `#8b949e` | 16          | `syn-text-secondary` | Labels, secondary text         |
| `#e6edf3` | 2           | `syn-text-primary`   | Main body text                 |
| `#f0f6fc` | 3           | `syn-text-bright`    | Headings, emphasis             |

**Intentional exceptions (do NOT tokenize):**

- `#1a1a2e` / `#16162a` — Tour gradient colors in `TourLauncher.tsx` / `TourOverlay.tsx` (feature-specific, not theme-controllable)
- Hex values inside `ExportDialog.tsx` inline HTML export template strings — these are for downloaded files, not the live UI
- Chart palette colors — managed separately by the chart system

---

## Files to Create / Modify

| File                                                                   | Action | What Changes                                     |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| `apps/dashboard/src/index.css`                                         | Modify | Add `@theme` block after `@import "tailwindcss"` |
| `apps/dashboard/index.html`                                            | Modify | Update body class; add flash-prevention script   |
| `apps/dashboard/src/App.tsx`                                           | Modify | Replace ~5 hardcoded hex values                  |
| `apps/dashboard/src/components/analytics/AnalyticsPage.tsx`            | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/analytics/coaching/ReportCardPanel.tsx` | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/analytics/coaching/PlaybookPanel.tsx`   | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/analytics/nudges/LiveNudgesView.tsx`    | Modify | ~15 replacements                                 |
| `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`   | Modify | ~18 replacements                                 |
| `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx`  | Modify | ~10 replacements                                 |
| `apps/dashboard/src/components/analytics/replay/SessionReplay.tsx`     | Modify | ~9 replacements                                  |
| `apps/dashboard/src/components/analytics/shared/ChartCard.tsx`         | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/analytics/shared/KpiCard.tsx`           | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/Header.tsx`                      | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/ActionsMenu.tsx`                 | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/SessionSelector.tsx`             | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/TimeFilterDropdown.tsx`          | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx`        | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx`    | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/lens/LensPanel.tsx`                     | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/mobile/MobileTabBar.tsx`                | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/mobile/MobileSettingsButton.tsx`        | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`            | Modify | ~9 replacements                                  |
| `apps/dashboard/src/components/settings/HookControlsTab.tsx`           | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/WorkshopModal.tsx`                      | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/ConfirmDialog.tsx`                      | Modify | Replace hardcoded hex                            |
| `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`          | Modify | Replace `#1a1d27` → `bg-syn-bg-tool-group`       |

---

## Chunk 0: Pre-flight — Reconcile File List <!-- revised: added to catch missed files before migration starts -->

### Task 0: Scan and reconcile all files with hardcoded hex

The file list below is based on a scan snapshot. Run this first to confirm nothing was missed.

- [ ] **Step 1: Run full hex scan**

```bash
grep -rn "bg-\[#\|text-\[#\|border-\[#\|ring-\[#\|from-\[#\|to-\[#\|fill-\[#\|stroke-\[#\|shadow-\[#\|divide-\[#\|outline-\[#" \
  apps/dashboard/src --include="*.tsx" --include="*.ts" \
  | grep -v "ExportDialog\|TourLauncher\|TourOverlay" \
  | grep -oP '"[^"]*"' | sort | uniq -c | sort -rn | head -40
```

- [ ] **Step 2: Compare with file list**

Cross-reference the grep output against the "Files to Create / Modify" table. Add any missing files to the migration tasks before proceeding.

- [ ] **Step 3: Note any unexpected hex values**

If any hex value not in the Color Token Map appears, decide: add a new token, or document as exception. Do not silently skip it.

---

## Chunk 1: Token Foundation

### Task 1: Add `@theme` block to `index.css`

**Files:**

- Modify: `apps/dashboard/src/index.css` (line 1 area)

- [ ] **Step 1: Read current `index.css` to confirm line 1**

```bash
head -5 apps/dashboard/src/index.css
```

Expected: first line is `@import "tailwindcss";`

- [ ] **Step 2: Add `@theme` block**

In `apps/dashboard/src/index.css`, after line 1 (`@import "tailwindcss";`), insert:

```css
@theme {
  --color-syn-bg-primary: #0d1117;
  --color-syn-bg-surface: #161b22;
  --color-syn-bg-elevated: #1c2128;
  --color-syn-bg-overlay: #1c2333;
  --color-syn-bg-tool-group: #1a1d27;
  --color-syn-border-primary: #30363d;
  --color-syn-border-subtle: #21262d;
  --color-syn-border-muted: #484f58;
  --color-syn-text-primary: #e6edf3;
  --color-syn-text-secondary: #8b949e;
  --color-syn-text-bright: #f0f6fc;
}
```

**Why `--color-` prefix?** Tailwind 4 maps `--color-*` theme variables to utility classes automatically. `--color-syn-bg-primary` becomes `bg-syn-bg-primary`, `text-syn-bg-primary`, `border-syn-bg-primary`, etc.

- [ ] **Step 3: Verify build compiles**

```bash
cd apps/dashboard && pnpm build 2>&1 | tail -20
```

Expected: build succeeds, no errors about unknown theme keys.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/index.css
git commit -m "feat(theme): add @theme CSS variable token block to index.css"
```

---

### Task 2: Update `index.html` — body class + flash prevention

**Files:**

- Modify: `apps/dashboard/index.html`

- [ ] **Step 1: Read current `index.html`**

Read `apps/dashboard/index.html` to see current body class and head content.

- [ ] **Step 2: Update body class**

Change body tag from:

```html
<body class="bg-[#0d1117] text-gray-200"></body>
```

to:

```html
<body class="bg-syn-bg-primary text-syn-text-primary"></body>
```

- [ ] **Step 3: Add flash-prevention script**

Add this inline script before `</head>` (reads saved theme from localStorage and injects it synchronously before React mounts):

```html
<!-- flash-prevention: injects saved custom theme vars before React mounts.
     CASCADE NOTE: document.head.appendChild() places this style AFTER the
     compiled <link rel="stylesheet"> in production (correct — user vars win).
     In Vite dev mode, CSS is injected by HMR JS so ordering is non-deterministic;
     flash prevention is a production-only guarantee. -->
<!-- revised: cascade ordering documented -->
<script>
  (function () {
    try {
      var saved = localStorage.getItem('synapse-custom-theme');
      if (saved) {
        var theme = JSON.parse(saved);
        if (theme.vars && Object.keys(theme.vars).length) {
          var css =
            ':root{' +
            Object.entries(theme.vars)
              .map(function (e) {
                return e[0] + ':' + e[1];
              })
              .join(';') +
            '}';
          var el = document.createElement('style');
          el.id = 'synapse-user-vars';
          el.textContent = css;
          document.head.appendChild(el);
        }
      }
    } catch (e) {}
  })();
</script>
```

- [ ] **Step 4: Verify page loads without flash**

```bash
cd apps/dashboard && pnpm build && pnpm preview
```

Test flash prevention in production mode (not dev — see cascade note above):

1. Open DevTools console, run: `localStorage.setItem('synapse-custom-theme', JSON.stringify({vars:{'--color-syn-bg-primary':'#ff0000'}}))`
2. Hard refresh — page background should be red **before** React mounts
3. Clean up: `localStorage.removeItem('synapse-custom-theme')` + refresh to confirm default dark theme returns

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/index.html
git commit -m "feat(theme): add flash-prevention script and migrate body class to semantic tokens"
```

---

## Chunk 2: Core Component Migration — Backgrounds

### Task 3: Migrate App.tsx and layout components

**Files:**

- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/layout/Header.tsx`
- Modify: `apps/dashboard/src/components/layout/ActionsMenu.tsx`
- Modify: `apps/dashboard/src/components/layout/SessionSelector.tsx`
- Modify: `apps/dashboard/src/components/layout/TimeFilterDropdown.tsx`
- Modify: `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx`
- Modify: `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx`

**Replacement map to apply in all files:** <!-- revised: expanded to cover all Tailwind prefix variants, not just bg/border/text -->

Apply this map for ALL Tailwind prefix variants: `bg-`, `text-`, `border-`, `ring-`, `divide-`, `from-`, `via-`, `to-`, `fill-`, `stroke-`, `shadow-`, `outline-`, `placeholder-`, `caret-`. Also applies to modifier variants: `hover:bg-[#...]`, `focus:bg-[#...]`, `dark:bg-[#...]`, `group-hover:bg-[#...]` etc.

| Hex       | Semantic Token       |
| --------- | -------------------- |
| `#0d1117` | `syn-bg-primary`     |
| `#161b22` | `syn-bg-surface`     |
| `#1c2128` | `syn-bg-elevated`    |
| `#1c2333` | `syn-bg-overlay`     |
| `#1a1d27` | `syn-bg-tool-group`  |
| `#30363d` | `syn-border-primary` |
| `#21262d` | `syn-border-subtle`  |
| `#484f58` | `syn-border-muted`   |
| `#8b949e` | `syn-text-secondary` |
| `#e6edf3` | `syn-text-primary`   |
| `#f0f6fc` | `syn-text-bright`    |

**Examples:**

- `bg-[#161b22]` → `bg-syn-bg-surface`
- `hover:bg-[#1c2128]` → `hover:bg-syn-bg-elevated`
- `border-[#30363d]` → `border-syn-border-primary`
- `text-[#8b949e]` → `text-syn-text-secondary`

- [ ] **Step 1: Apply replacements to App.tsx**

Read `apps/dashboard/src/App.tsx`, find all instances of hardcoded hex Tailwind classes, replace with semantic tokens per the map above.

- [ ] **Step 2: Apply replacements to layout components**

Read and update each layout file: `Header.tsx`, `ActionsMenu.tsx`, `SessionSelector.tsx`, `TimeFilterDropdown.tsx`, `ViewSettingsDropdown.tsx`, `KeyboardShortcutsTooltip.tsx`.

- [ ] **Step 3: Visual smoke test**

```bash
cd apps/dashboard && pnpm dev
```

Open http://localhost:5173 — header, dropdowns, session selector should look identical to before.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/App.tsx apps/dashboard/src/components/layout/
git commit -m "feat(theme): migrate App.tsx and layout components to semantic color tokens"
```

---

### Task 4: Migrate panel and modal components

**Files:**

- Modify: `apps/dashboard/src/components/panels/AgentDetailPanel.tsx`
- Modify: `apps/dashboard/src/components/WorkshopModal.tsx`
- Modify: `apps/dashboard/src/components/ConfirmDialog.tsx`
- Modify: `apps/dashboard/src/components/settings/HookControlsTab.tsx`
- Modify: `apps/dashboard/src/components/lens/LensPanel.tsx`
- Modify: `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx`

Apply the same replacement map from Task 3. For `ToolGroupNode.tsx`, also replace `bg-[#1a1d27]` → `bg-syn-bg-tool-group`.

- [ ] **Step 1: Apply replacements to all panel/modal files**

Read and update each file per the replacement map.

- [ ] **Step 2: Smoke test panels**

Open the app → click on an agent to open AgentDetailPanel → open WorkshopModal (if available) → open settings → verify all render correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/panels/ apps/dashboard/src/components/WorkshopModal.tsx apps/dashboard/src/components/ConfirmDialog.tsx apps/dashboard/src/components/settings/ apps/dashboard/src/components/lens/ apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx
git commit -m "feat(theme): migrate panels, modals, and graph nodes to semantic color tokens"
```

---

### Task 5: Migrate mobile components

**Files:**

- Modify: `apps/dashboard/src/components/mobile/MobileTabBar.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileSettingsButton.tsx`

Apply same replacement map. `MobileSettingsButton.tsx` uses `#1c2333` → `bg-syn-bg-overlay`.

- [ ] **Step 1: Apply replacements**

Read and update both files.

- [ ] **Step 2: Smoke test mobile view**

Open http://localhost:5173?view=mobile — tab bar and settings button should render correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/mobile/
git commit -m "feat(theme): migrate mobile components to semantic color tokens"
```

---

## Chunk 3: Analytics Components (highest density)

### Task 6: Migrate analytics shared components

**Files:**

- Modify: `apps/dashboard/src/components/analytics/shared/ChartCard.tsx`
- Modify: `apps/dashboard/src/components/analytics/shared/KpiCard.tsx`
- Modify: `apps/dashboard/src/components/analytics/AnalyticsPage.tsx`

These are high-density files — `KpiCard.tsx` uses both `#161b22` and `#1c2128` for nested card states.

- [ ] **Step 1: Read each file**

Read all three files and identify every hardcoded hex class.

- [ ] **Step 2: Apply replacements**

Update per replacement map. Pay attention to hover/focus variants like `hover:bg-[#1c2128]` → `hover:bg-syn-bg-elevated`.

- [ ] **Step 3: Smoke test analytics**

Navigate to the Analytics tab — KPI cards, chart cards, and page layout should look identical.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/analytics/shared/ apps/dashboard/src/components/analytics/AnalyticsPage.tsx
git commit -m "feat(theme): migrate analytics shared components to semantic color tokens"
```

---

### Task 7: Migrate analytics feature components (high density)

**Files:**

- Modify: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx` (~18 instances)
- Modify: `apps/dashboard/src/components/analytics/nudges/LiveNudgesView.tsx` (~15 instances)
- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx` (~10 instances)
- Modify: `apps/dashboard/src/components/analytics/replay/SessionReplay.tsx` (~9 instances)
- Modify: `apps/dashboard/src/components/analytics/coaching/ReportCardPanel.tsx`
- Modify: `apps/dashboard/src/components/analytics/coaching/PlaybookPanel.tsx`

- [ ] **Step 1: Read and update PromptAnalyzer.tsx**

Read file, apply all replacements. Check for variants (hover:, focus:, dark:).

- [ ] **Step 2: Read and update LiveNudgesView.tsx**

- [ ] **Step 3: Read and update remaining analytics files**

Update `PromptWorkshop.tsx`, `SessionReplay.tsx`, `ReportCardPanel.tsx`, `PlaybookPanel.tsx`.

- [ ] **Step 4: Smoke test analytics tabs**

Navigate through all 5 analytics tabs (Executive, Prompts, Workshop, Insights, Live Nudges) — verify each renders correctly.

- [ ] **Step 5: Run tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all existing tests pass (no visual tests that check hex values).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/analytics/
git commit -m "feat(theme): migrate analytics feature components to semantic color tokens"
```

---

## Chunk 4: Verification Pass

### Task 8: Grep for remaining hardcoded hex values

After all migrations, run a final scan to catch anything missed.

- [ ] **Step 1: Scan for remaining arbitrary hex classes**

```bash
grep -r "bg-\[#\|text-\[#\|border-\[#\|ring-\[#\|from-\[#\|to-\[#" apps/dashboard/src --include="*.tsx" --include="*.ts" | grep -v "ExportDialog\|TourLauncher\|TourOverlay"
```

Expected: no output (all migrated). Any remaining lines are either intentional exceptions or missed files.

- [ ] **Step 2: Fix any remaining instances**

For each unexpected result, read the file and apply the appropriate semantic token.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3b: Verify VS Code extension build** <!-- revised: extension build added to catch bundling regressions -->

```bash
cd apps/vscode && pnpm run package 2>&1 | tail -20
```

Expected: `.vsix` produced without errors. The token classes must compile correctly in the extension's bundled dashboard.

- [ ] **Step 4: Full visual review**

Check all views:

- Full view (graph + header + panels)
- Lens panel (all 6 tabs)
- Analytics (all 5 tabs)
- Mobile view (`?view=mobile`)
- Confirm dialog (trigger via "Clear All" in header)
- Settings panel
- Dropdowns (session selector, view settings, actions menu)
- ToolGroupNode (run simulation to generate tool nodes: `npx tsx scripts/simulate_all_nodes.ts`)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(theme): complete CSS variable migration — all hex values replaced with semantic tokens"
```

---

## Completion Checklist

- [ ] `@theme` block in `index.css` with 11 semantic tokens
- [ ] `index.html` body class uses semantic tokens
- [ ] Flash-prevention script in `index.html`
- [ ] Zero remaining `bg-[#`, `text-[#`, `border-[#` in `src/` (outside known exceptions)
- [ ] All existing tests pass
- [ ] All 5 views render correctly and match previous appearance

---

## Open Questions / Deferred (P2)

These were flagged in plan review but are not blocking. Address in a follow-up pass if needed.

**1. CSS-only hex values in `index.css` not migrated**
`#30363d`, `#21262d`, `#484f58` appear in raw CSS rules inside `index.css` (`.mermaid-dark`, `@supports` blocks) — not as Tailwind arbitrary classes. The replacement map won't catch these. They remain static hex. Future: manually update these to `var(--color-syn-border-primary)` etc.

**2. `text-gray-200` → `text-syn-text-primary` is a slight color value change**
`gray-200` ≈ `#e5e7eb`; `syn-text-primary` = `#e6edf3`. Intentional: `#e6edf3` is the GitHub Dark palette value, more accurate. Not a regression — document this if reviewers flag it.

**3. Tailwind named color utilities (`gray-*`, `blue-*` etc.) are out of scope**
This migration only targets hardcoded hex arbitrary values. `text-gray-400`, `border-gray-700`, `bg-blue-500` etc. are not being tokenized in this pass. Future: sweep gray/blue utilities into semantic tokens if a full design system is desired.

**4. Visual diffing strategy**
No automated visual regression is in place. Recommendation: take before/after screenshots of each view (Full, Lens, Analytics, Mobile, Dropdowns) before starting Task 3. Use browser DevTools Computed panel to verify a few key elements resolve to the correct hex values after migration.

**5. Tour gradient colors (`#1a1a2e` / `#16162a`) left as-is**
These are feature-specific brand colors for the tour overlay. Currently excepted. If a future "brand theme" token is added (e.g. `syn-brand-gradient-start`), these would be candidates.

---

## Known Exceptions (intentional, do not migrate)

- `apps/dashboard/src/features/tour/TourLauncher.tsx` — `from-[#1a1a2e] to-[#16162a]` (tour brand gradient)
- `apps/dashboard/src/features/tour/TourOverlay.tsx` — same tour gradient colors
- `apps/dashboard/src/components/analytics/export/ExportDialog.tsx` — all hex values inside inline HTML export template strings (for downloaded files, not live UI)
- Chart palette colors — managed by the chart system independently
