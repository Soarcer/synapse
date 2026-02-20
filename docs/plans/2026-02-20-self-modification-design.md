# Self-Modification Feature — Design Document

**Date:** 2026-02-20 (revised after codebase cleanup)
**Status:** Design approved, spec hardened after codebase audit

## Problem Statement

Users should be able to type a natural-language prompt (e.g., "change the color scheme to dark blue") and have AI modify the Synapse dashboard's appearance and add custom visualizations — without ever touching or breaking core functionality.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Modification scope | CSS variables + scoped CSS + custom lenses | Incremental — CSS for visuals, JSON configs for behavior. Architectured for future expansion. |
| Persistence | localStorage | Simple, instant, per-browser. No server state needed. |
| AI backend | New `anthropicFetch()` in server | Written from scratch — no existing AI-calling code in the codebase. Reads `ANTHROPIC_API_KEY` env var directly. |
| UI entry point | Floating button + modal | Non-intrusive, works in all view modes, supports live preview and iteration. |
| Feature flag | `synapse.experimental.selfModify` | Defaults false. Hides the ✦ button entirely. Zero impact on public release. |

## Architecture Overview

```
User prompt ──→ Frontend modal
                    │
                    ▼
            POST /api/customize
                    │
                    ▼
         Server: anthropicFetch()
         (claude-haiku-4-5-20251001, structured JSON)
                    │
                    ▼
         Server: validate & sanitize
         ├── Strip markdown fencing from response
         ├── JSON.parse with try/catch
         ├── Variable allowlist check
         ├── CSS sanitizer (property allowlist + selector scoping)
         ├── Lens config Zod validation
         └── Expression safe-eval validation
                    │
                    ▼
         Return validated JSON
                    │
                    ▼
         Frontend: apply live
         ├── Inject <style> tags (vars + CSS)
         ├── Register custom lens (if present)
         └── Save to localStorage
```

---

## 1. CSS Variable Layer

### 1.1 Theme Variables

Add a `@theme` block to `apps/dashboard/src/index.css` (after `@import "tailwindcss"` on line 1).

**Tailwind 4 behavior:** `@theme` blocks emit CSS custom properties on `:root` at runtime. Tailwind utility classes reference these variables (e.g., `bg-syn-bg-primary` compiles to `background-color: var(--color-syn-bg-primary)`). This is what makes runtime overrides possible.

```css
@theme {
  --color-syn-bg-primary: #0d1117;
  --color-syn-bg-surface: #161b22;
  --color-syn-bg-elevated: #1c2129;
  --color-syn-border-primary: #30363d;
  --color-syn-border-subtle: #21262d;
  --color-syn-text-primary: #e6edf3;
  --color-syn-text-secondary: #8b949e;
  --color-syn-text-muted: #6e7681;
  --color-syn-accent: #58a6ff;
  --color-syn-accent-hover: #79c0ff;
  --color-syn-success: #3fb950;
  --color-syn-error: #f85149;
  --color-syn-warning: #d29922;
  --color-syn-info: #a371f7;
  --syn-panel-gap: 8px;
  --syn-radius: 8px;
  --syn-header-height: 48px;
}
```

### 1.2 Migration Strategy

Replace hardcoded arbitrary-value classes across ~37 files:

| Before | After |
|---|---|
| `bg-[#0d1117]` | `bg-syn-bg-primary` |
| `bg-[#161b22]` | `bg-syn-bg-surface` |
| `bg-[#1c2129]` / `bg-[#21262d]` | `bg-syn-bg-elevated` |
| `border-[#30363d]` | `border-syn-border-primary` |

**Exceptions:** Pixel scene colors (PixiJS config objects, not Tailwind), chart palette colors, one-off highlights.

Also update `index.html` body: `bg-[#0d1117] text-gray-200` → `bg-syn-bg-primary text-syn-text-primary`.

### 1.3 Override Mechanism

Two injected `<style>` tags:

```html
<style id="synapse-user-vars">:root { --color-syn-bg-primary: #0a1628; }</style>
<style id="synapse-user-css">.synapse-user-mods .node-session { border-left: 3px solid #4a90d9; }</style>
```

Root `<div id="root">` gets `class="synapse-user-mods"` when customizations are active.

### 1.4 Flash Prevention

Inline `<script>` in `index.html` (before `</head>`) applies saved theme from localStorage before React mounts. Uses `var` and `function(){}` for compat without transpilation.

---

## 2. AI Integration

### 2.1 Server-Side AI Client (New Module)

**No AI-calling code exists in the current codebase** — `aiCoachService.ts` and `settingsService.ts` were deleted in the recent cleanup. The Anthropic client must be written from scratch.

Create `packages/server/src/services/anthropicClient.ts`:

```typescript
export async function anthropicFetch(params: {
  model: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
  timeoutMs?: number;  // default 30_000
}): Promise<string>
```

- Reads API key from `process.env.ANTHROPIC_API_KEY` directly (no settings service abstraction)
- `AbortController` timeout (default 30s)
- 3 retries on 429, exponential backoff (1s/2s/4s)
- Concurrency guard (max 10 in-flight calls)
- Model allowlist: `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-opus-4-6`

### 2.2 Endpoint

`POST /api/customize`

**Request (Zod-validated):**
```typescript
const CustomizeRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  currentTheme: z.record(z.string(), z.string()).optional(),
  conversationContext: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(2000),
  })).max(6).optional(),
  existingLenses: z.array(z.string()).max(3).optional(),
});
```

**Response:** `{ overrides?, scopedCss?, lens?, description? }` — all channels optional.

### 2.3 Error Envelope

```typescript
interface CustomizeError { error: string; message: string; }
```

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Zod validation fails |
| 401 | `no_api_key` | `ANTHROPIC_API_KEY` not set |
| 422 | `ai_parse_error` | AI returned non-JSON |
| 422 | `ai_empty_response` | All channels empty after sanitization |
| 429 | `rate_limited` | 10 req/min limit exceeded |
| 504 | `ai_timeout` | 30s timeout |
| 502 | `ai_upstream_error` | Anthropic 4xx/5xx |

On 401: modal shows "Set `ANTHROPIC_API_KEY` environment variable to enable AI customization" (no settings UI exists to link to).

### 2.4 Response Parsing

1. Strip markdown fencing (` ```json ... ``` `)
2. JSON.parse with try/catch
3. Per-channel validation (variable allowlist, CSS sanitizer, lens schema)
4. Empty check

### 2.5 Rate Limiting

Dedicated limiter in `app.ts`: `rateLimit({ windowMs: 60_000, max: 10 })` on `/api/customize`.

---

## 3. Scoped CSS Sanitizer

(Unchanged from previous version — see full spec for details)

- Comma-safe selector prepending under `.synapse-user-mods`
- CSS comment stripping before property validation
- Property allowlist (visual-only: color, background, border, font, spacing, opacity, transform)
- Blocked patterns: `url(`, `expression(`, `@import`, `javascript:`, etc.
- 5 KB size cap

---

## 4. Custom Lens

### 4.1 Data Source

All lens views consume `LensTreeNode[]` from `LensContext.treeRoots`. Fields: `id`, `kind`, `label`, `status`, `tokens`, `count`, `duration`, `startTime`, `endTime`, `depth`, `children`, `groupCount`, `groupedIds`.

### 4.2 Configuration

```typescript
interface LensConfig {
  id: string;
  name: string;                // 1–20 chars, unique
  chartType: 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'radar' | 'table';
  dataMapping: {
    source: 'tree';
    nodeKind?: 'session' | 'prompt' | 'agent' | 'tool';
    x: string;    y: string;
    color?: string;    groupBy?: string;
    sortBy?: 'x' | 'y';    sortOrder?: 'asc' | 'desc';
    filter?: { field: string; op: string; value: string | number };
    limit?: number;  // default 50, max 200
  };
  options?: { stacked?: boolean; showLegend?: boolean; xAxisLabel?: string; yAxisLabel?: string; };
}
```

### 4.3 Expression Evaluator

Recursive-descent parser. Field access + arithmetic + constants. Division by zero → 0, undefined fields → 0, strings in arithmetic → 0.

### 4.4 Integration

Custom lenses appear as additional tabs in `LensTabBar` after the built-in 6. Keys 7–9. Max 3 active.

---

## 5. UI: Customize Modal

### 5.1 Entry Point

Floating `✦` button (bottom-right, fixed). Keyboard shortcut: **M** (with `isEditableTarget()` guard — same pattern as existing shortcuts in `App.tsx` line 25–31). Hidden when `experimentalSelfModify` is false.

### 5.2 Flow

1. Click ✦ / press M → modal opens, snapshot current state
2. Type prompt, Enter → POST /api/customize → loading spinner
3. Success → live preview behind modal + refinement input + [Apply & Close] [Revert] [Reset]
4. Error → display message (401: "Set ANTHROPIC_API_KEY", 429: countdown, 504: "try simpler")
5. Escape / click outside → revert to pre-modal state

### 5.3 Mounting

Add `<CustomizeModal />` in all view branches in `App.tsx`:
- `FullView` (line 279, before `<ToastContainer>`)
- `graph` view (line 242)
- `lens` view (line 228)
- NOT in `pixel` or `analytics` views (not relevant there)

Lazy-loaded: `const CustomizeModal = lazy(() => import('./components/customize/CustomizeModal'));`

---

## 6. Sandboxing

Six layers unchanged: JSON output contract → variable allowlist → value sanitization → CSS property allowlist → rate limiting → undo stack.

Core isolation guarantee: theme variables are purely visual. A broken theme cannot affect event processing, WebSocket, or stored data.

---

## 7. Feature Flag

The entire feature is gated by a single boolean. When false, the ✦ button doesn't render. Everything else (route, validators, schemas) is dead code with zero UI surface. No impact on the public VS Code extension release.

---

## 8. Files to Create/Modify

### New Files
- `packages/core/src/themeVariables.ts` — variable registry
- `packages/core/src/customizeSchema.ts` — Zod schemas + types
- `packages/core/src/cssSanitizer.ts` — CSS sanitizer
- `packages/core/src/safeExprEval.ts` — expression parser
- `packages/server/src/services/anthropicClient.ts` — Anthropic API client (from scratch)
- `packages/server/src/services/customizeService.ts` — prompt + validation orchestration
- `packages/server/src/routes/customize.ts` — POST /api/customize
- `apps/dashboard/src/components/customize/CustomizeModal.tsx` — UI
- `apps/dashboard/src/components/customize/ThemeManager.ts` — apply/revert/persist
- `apps/dashboard/src/components/lens/custom/CustomLens.tsx` — chart component

### Modified Files
- `apps/dashboard/src/index.css` — add `@theme` block (after line 1)
- `apps/dashboard/index.html` — add theme init script + update body class
- ~37 component files — migrate hex colors to semantic utilities
- `apps/dashboard/src/App.tsx` — M shortcut (line 188 area), CustomizeModal mount
- `apps/dashboard/src/store/agentStore.ts` — add customize state fields (line 124 area)
- `apps/dashboard/src/components/lens/LensContext.tsx` — extend `LensTab` type (line 6)
- `apps/dashboard/src/components/lens/LensTabBar.tsx` — render custom tabs
- `apps/dashboard/src/components/lens/LensPanel.tsx` — render CustomLens
- `packages/server/src/app.ts` — mount route (after line 73), add rate limiter (line 61 area)
- `packages/core/src/index.ts` — add exports (after line 58)

### localStorage Keys
- `synapse-custom-theme` — `{ vars, css, lenses }`
- `synapse-theme-history` — array of `ThemeHistoryEntry` (max 5)
