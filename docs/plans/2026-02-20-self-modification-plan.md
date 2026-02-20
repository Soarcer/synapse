# Self-Modification Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users type natural-language prompts to modify the dashboard's appearance and add custom chart visualizations, sandboxed so core functionality is never affected.

**Architecture:** New server-side Anthropic API client (no existing AI code in codebase) returns validated JSON with three optional channels: CSS variable overrides, scoped CSS rules, and chart lens configurations. Frontend applies these live via `<style>` injection and a configurable `CustomLens` Recharts component. Feature is hidden behind a boolean flag that defaults to off.

**Tech Stack:** Tailwind CSS 4 `@theme` tokens, Zod validation, Recharts, recursive-descent expression parser, Express rate limiting.

**Design doc:** `docs/plans/2026-02-20-self-modification-design.md`

---

## Task 1: Theme Variables Registry

**Files:**
- Create: `packages/core/src/themeVariables.ts`
- Test: `packages/core/src/__tests__/themeVariables.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  THEME_VARIABLES,
  getThemeDefaults,
  isValidThemeKey,
  validateThemeValue,
} from '../themeVariables.js';

describe('THEME_VARIABLES', () => {
  it('contains all expected color tokens', () => {
    expect(THEME_VARIABLES['--color-syn-bg-primary']).toBeDefined();
    expect(THEME_VARIABLES['--color-syn-accent']).toBeDefined();
    expect(THEME_VARIABLES['--color-syn-success']).toBeDefined();
  });

  it('contains non-color tokens', () => {
    expect(THEME_VARIABLES['--syn-radius']).toBeDefined();
    expect(THEME_VARIABLES['--syn-radius'].type).toBe('size');
  });

  it('each variable has type, default, and description', () => {
    for (const [, val] of Object.entries(THEME_VARIABLES)) {
      expect(val.type).toMatch(/^(color|size)$/);
      expect(val.default).toBeTruthy();
      expect(val.description).toBeTruthy();
    }
  });
});

describe('isValidThemeKey', () => {
  it('accepts known keys', () => expect(isValidThemeKey('--color-syn-bg-primary')).toBe(true));
  it('rejects unknown keys', () => expect(isValidThemeKey('--evil-var')).toBe(false));
});

describe('validateThemeValue', () => {
  it('accepts hex colors', () => expect(validateThemeValue('color', '#0d1117')).toBe(true));
  it('accepts rgb/hsl', () => expect(validateThemeValue('color', 'rgb(10, 20, 30)')).toBe(true));
  it('accepts safe named colors', () => expect(validateThemeValue('color', 'navy')).toBe(true));
  it('rejects inherit/currentColor/transparent', () => {
    expect(validateThemeValue('color', 'inherit')).toBe(false);
    expect(validateThemeValue('color', 'transparent')).toBe(false);
  });
  it('rejects url/expression/var', () => {
    expect(validateThemeValue('color', 'url(evil.png)')).toBe(false);
    expect(validateThemeValue('color', 'var(--other)')).toBe(false);
  });
  it('rejects values over 100 chars', () => expect(validateThemeValue('color', '#' + 'a'.repeat(200))).toBe(false));
  it('accepts valid sizes', () => expect(validateThemeValue('size', '8px')).toBe(true));
  it('rejects negative sizes', () => expect(validateThemeValue('size', '-8px')).toBe(false));
});

describe('getThemeDefaults', () => {
  it('returns flat key-value map', () => {
    const defaults = getThemeDefaults();
    expect(defaults['--color-syn-bg-primary']).toBe('#0d1117');
  });
});
```

**Step 2:** Run: `cd packages/core && npx vitest run src/__tests__/themeVariables.test.ts` → FAIL

**Step 3:** Implement `themeVariables.ts` — `THEME_VARIABLES` map (17 tokens), `isValidThemeKey()`, `validateThemeValue()` with regex + named color allowlist + blocked patterns, `getThemeDefaults()`.

**Step 4:** Run same test → PASS

**Step 5:** `git add packages/core/src/themeVariables.ts packages/core/src/__tests__/themeVariables.test.ts && git commit -m "feat(core): add theme variables registry with validation"`

---

## Task 2: CSS Sanitizer

**Files:**
- Create: `packages/core/src/cssSanitizer.ts`
- Test: `packages/core/src/__tests__/cssSanitizer.test.ts`

**Step 1: Write the failing test**

Test cases for: selector scoping (including comma-safe), comment stripping, property allowlist filtering, blocked pattern removal, size cap (5KB), empty input.

**Step 2:** Run → FAIL

**Step 3:** Implement `sanitizeScopedCss(input: string): { css: string; truncated: boolean }` with internal helpers for comment stripping, per-selector prepending, property filtering, blocked pattern removal.

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(core): add CSS sanitizer with property allowlist and selector scoping"`

---

## Task 3: Safe Expression Evaluator

**Files:**
- Create: `packages/core/src/safeExprEval.ts`
- Test: `packages/core/src/__tests__/safeExprEval.test.ts`

**Step 1: Write the failing test**

Test: field access, arithmetic, parentheses, division by zero → 0, undefined fields → 0, string fields in arithmetic → 0, string field standalone returns string, `validateExpression()` rejects >100 chars and disallowed characters.

**Step 2:** Run → FAIL

**Step 3:** Implement recursive-descent parser. Tokenizer → NUMBER/IDENT/OP/PAREN. Parser: `expr → term ((+|-) term)*`, `term → factor ((*|/) factor)*`, `factor → NUMBER | IDENT | (expr)`. NOT `eval()`.

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(core): add safe expression evaluator for custom lens data mapping"`

---

## Task 4: Customize Zod Schemas

**Files:**
- Create: `packages/core/src/customizeSchema.ts`
- Test: `packages/core/src/__tests__/customizeSchema.test.ts`

**Step 1:** Test: `CustomizeRequestSchema` (valid/empty/oversized prompt, context bounds), `LensConfigSchema` (valid config, name length, invalid chartType, limit cap), `deduplicateLensName` (no conflict, duplicate, built-in name collision).

**Step 2:** Run → FAIL

**Step 3:** Implement schemas and helpers per design doc Sections 2.2 and 4.2.

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(core): add Zod schemas for customize API and lens config"`

---

## Task 5: Export New Modules from @synapse-ai/core

**Files:**
- Modify: `packages/core/src/index.ts` (append after line 58)

**Step 1:** Add exports for `themeVariables`, `cssSanitizer`, `safeExprEval`, `customizeSchema` — both value and type exports.

**Step 2:** Run: `cd packages/core && npx tsc --noEmit` → PASS

**Step 3:** Commit: `"feat(core): export theme customization modules"`

---

## Task 6: Anthropic API Client (From Scratch)

**Files:**
- Create: `packages/server/src/services/anthropicClient.ts`
- Test: `packages/server/src/__tests__/anthropicClient.test.ts`

**Important context:** There is NO existing AI-calling code in this codebase. `aiCoachService.ts` and `settingsService.ts` were deleted in a recent cleanup. This module is written from scratch.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('anthropicFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  });

  it('returns text content on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"overrides":{}}' }] }),
    });
    const { anthropicFetch } = await import('../services/anthropicClient.js');
    const result = await anthropicFetch({
      model: 'claude-haiku-4-5-20251001',
      system: 'You are helpful',
      userMessage: 'test',
    });
    expect(result).toBe('{"overrides":{}}');
  });

  it('rejects unknown model', async () => {
    const { anthropicFetch } = await import('../services/anthropicClient.js');
    await expect(
      anthropicFetch({ model: 'gpt-4', system: '', userMessage: '' })
    ).rejects.toThrow(/not in the allowed list/);
  });

  it('throws when no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { anthropicFetch } = await import('../services/anthropicClient.js');
    await expect(
      anthropicFetch({ model: 'claude-haiku-4-5-20251001', system: '', userMessage: '' })
    ).rejects.toThrow(/API key/i);
  });
});
```

**Step 2:** Run → FAIL

**Step 3:** Implement `anthropicClient.ts`:
- `ALLOWED_MODELS` set: `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-opus-4-6`
- API key: `process.env.ANTHROPIC_API_KEY` — throw if missing
- `AbortController` timeout (default 30s)
- Retry loop: 3 retries on 429, backoff 1s/2s/4s
- Concurrency guard: max 10 via module-level counter
- POST to `https://api.anthropic.com/v1/messages`

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(server): add Anthropic API client with timeout and retry"`

---

## Task 7: Customize Service

**Files:**
- Create: `packages/server/src/services/customizeService.ts`
- Test: `packages/server/src/__tests__/customizeService.test.ts`

**Step 1:** Test: `stripMarkdownFencing` (json fenced, plain fenced, no fencing), `validateAiResponse` (valid overrides, unknown keys stripped, scopedCss sanitized, lens validated, all-empty returns null), `buildSystemPrompt` (includes variable names).

**Step 2:** Run → FAIL

**Step 3:** Implement orchestration: `stripMarkdownFencing()`, `buildSystemPrompt()`, `validateAiResponse()`, `generateCustomization()` (calls `anthropicFetch`, strips fencing, JSON-parses, validates).

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(server): add customize service with AI response validation"`

---

## Task 8: Customize Route + App Mount

**Files:**
- Create: `packages/server/src/routes/customize.ts`
- Modify: `packages/server/src/app.ts`

**Step 1:** Write route test with mocked `customizeService`.

**Step 2:** Run → FAIL (404)

**Step 3:** Create `customize.ts` route handler. Modify `app.ts`:
- Add import after line 11: `import { createCustomizeRouter } from './routes/customize.js';`
- Add rate limiter in the `if (!deps.disableRateLimiting)` block (after line 61): `const customizeLimiter = rateLimit({ windowMs: 60_000, max: 10, ... }); app.use('/api/customize', customizeLimiter);`
- Mount route after line 73: `app.use('/api/customize', createCustomizeRouter());`

**Step 4:** Run `cd packages/server && npx vitest run` → ALL PASS

**Step 5:** Commit: `"feat(server): add POST /api/customize route with rate limiting"`

---

## Task 9: CSS @theme Block

**Files:**
- Modify: `apps/dashboard/src/index.css` (insert after line 1)

**Step 1:** Insert `@theme { ... }` block with all 17 tokens after `@import "tailwindcss";` on line 1. Also update any hardcoded hex values in the raw CSS below (React Flow overrides, scrollbar styles) to use `var(--color-syn-*)`.

**Step 2:** Run: `cd apps/dashboard && npx vite build` → Build succeeds

**Step 3:** Commit: `"feat(dashboard): add Tailwind 4 @theme block with semantic color tokens"`

---

## Task 10: Component Color Migration

**Files:**
- Modify: ~37 files across `apps/dashboard/src/`

**Step 1:** Grep for all `bg-[#`, `border-[#`, `text-[#` patterns. Map each to semantic utilities per the migration table in the design doc.

**Step 2:** Apply replacements file by file. Exceptions: pixel scene colors, chart palettes, one-off highlights. Also update `index.html` body class: `bg-[#0d1117] text-gray-200` → `bg-syn-bg-primary text-syn-text-primary`.

**Step 3:** Run: `cd apps/dashboard && npx vite build` → Build succeeds

**Step 4:** `pnpm dev` → visually verify dashboard looks identical (same hex values, just referenced via variables now)

**Step 5:** Commit: `"refactor(dashboard): migrate hardcoded hex colors to semantic @theme tokens"`

---

## Task 11: ThemeManager

**Files:**
- Create: `apps/dashboard/src/components/customize/ThemeManager.ts`
- Test: `apps/dashboard/src/__tests__/ThemeManager.test.ts`

**Step 1:** Test: `saveTheme`, `loadSavedTheme` (null/valid/corrupt), `pushHistory` (caps at 5), `resetToDefault` (clears localStorage).

**Step 2:** Run → FAIL

**Step 3:** Implement: `applyTheme()`, `revertTheme()`, `resetToDefault()`, `saveTheme()`, `loadSavedTheme()`, `pushHistory()`, `getThemeHistory()`. localStorage keys: `synapse-custom-theme`, `synapse-theme-history`.

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(dashboard): add ThemeManager for apply/revert/persist customizations"`

---

## Task 12: Pre-React Theme Init Script

**Files:**
- Modify: `apps/dashboard/index.html`

**Step 1:** Insert `<script>` block before `</head>` (line 7). Uses `var`/`function(){}` for compat. Reads `synapse-custom-theme` from localStorage, injects `<style>` tags immediately.

**Step 2:** Run: `cd apps/dashboard && npx vite build` → Script preserved in output

**Step 3:** Commit: `"feat(dashboard): add pre-React theme init to prevent flash of default theme"`

---

## Task 13: Customize State in Store

**Files:**
- Modify: `apps/dashboard/src/store/agentStore.ts`

**Step 1:** Add fields to `AgentStore` interface (after line 131, the `selectSource` field):

```typescript
  // Customize state
  showCustomizeModal: boolean;
  customLenses: LensConfig[];
  experimentalSelfModify: boolean;
```

Add actions (after line 161):
```typescript
  setShowCustomizeModal: (show: boolean) => void;
  setCustomLenses: (lenses: LensConfig[]) => void;
```

Add initial values in `create()` and implement actions. `experimentalSelfModify` reads from `localStorage.getItem('synapse-experimental-self-modify') === 'true'` on init.

**Note:** The store has no persistence middleware. State that needs to survive reloads uses manual `localStorage` calls (same pattern as `ThemeManager`).

**Step 2:** Run: `cd apps/dashboard && npx tsc --noEmit` → No type errors

**Step 3:** Commit: `"feat(dashboard): add customize state to Zustand store"`

---

## Task 14: CustomizeModal Component

**Files:**
- Create: `apps/dashboard/src/components/customize/CustomizeModal.tsx`

**Step 1:** Build the component:
- Floating ✦ button (fixed, bottom-right, z-50)
- Early return `null` if `!experimentalSelfModify`
- Modal overlay with text input, loading state, result display, error handling
- `fetch(apiUrl('/api/customize'), ...)` with 35s AbortController
- Calls `ThemeManager.applyTheme()` / `.revertTheme()` / `.resetToDefault()`
- Error UX: 401 → "Set ANTHROPIC_API_KEY env var", 429 → countdown, 504 → "try simpler"
- Escape / click-outside → revert

Reference pattern: `SpawnAgentDialog.tsx` (existing modal in the codebase).

**Step 2:** Run: `npx tsc --noEmit` → No type errors

**Step 3:** Commit: `"feat(dashboard): add CustomizeModal with live preview and iteration"`

---

## Task 15: CustomLens Component

**Files:**
- Create: `apps/dashboard/src/components/lens/custom/CustomLens.tsx`
- Test: `apps/dashboard/src/__tests__/CustomLens.test.ts`

**Step 1:** Test: `flattenTree` (all nodes, filtered by kind), `applyMapping` (x/y mapping, filter, limit).

**Step 2:** Run → FAIL

**Step 3:** Implement:
- `flattenTree(roots, nodeKind?)` — recursive flatten with optional filter
- `applyMapping(nodes, dataMapping)` — evaluates expressions via `safeEval`, applies filter/sort/limit
- `CustomLens` component — reads `treeRoots` from `useLens()`, renders Recharts chart based on `chartType`
- Empty state messages, click-to-select, 200ms debounce

**Step 4:** Run → PASS

**Step 5:** Commit: `"feat(dashboard): add configurable CustomLens chart component"`

---

## Task 16: LensPanel + LensTabBar Integration

**Files:**
- Modify: `apps/dashboard/src/components/lens/LensContext.tsx` (line 6)
- Modify: `apps/dashboard/src/components/lens/LensTabBar.tsx`
- Modify: `apps/dashboard/src/components/lens/LensPanel.tsx`

**Step 1:** Extend `LensTab` type (LensContext.tsx line 6):
```typescript
export type LensTab = 'tree' | 'heatmap' | 'treemap' | 'sankey' | 'compaction' | 'cost' | `custom-${string}`;
```

**Step 2:** In `LensTabBar.tsx`, after the TABS map (line 12), read `customLenses` from store and render additional buttons with ◆ prefix.

**Step 3:** In `LensPanel.tsx`, after line 52 (last built-in view), add:
```tsx
{activeTab.startsWith('custom-') && <CustomLens config={...} />}
```

**Step 4:** Build: `npx tsc --noEmit && npx vite build` → PASS

**Step 5:** Commit: `"feat(dashboard): integrate custom lenses into LensPanel with tab switching"`

---

## Task 17: App.tsx Integration

**Files:**
- Modify: `apps/dashboard/src/App.tsx`

**Step 1:** Add lazy import: `const CustomizeModal = lazy(() => import('./components/customize/CustomizeModal'));`

**Step 2:** Add M keyboard shortcut in the shortcuts `useEffect` (after line 188, before the closing of the handler):
```typescript
if (e.key === 'm' || e.key === 'M') {
  const s = useAgentStore.getState();
  s.setShowCustomizeModal(!s.showCustomizeModal);
}
```
This is already guarded by `isEditableTarget(e)` at line 137.

**Step 3:** Mount `<CustomizeModal />` in `FullView` (line 279, before `<ToastContainer>`), `graph` view (line 242), and `lens` view (line 228).

**Step 4:** Add keys 7–9 for custom lens tab switching in the number keys block (after line 187).

**Step 5:** `pnpm dev` → verify M opens modal, Escape closes, shortcut doesn't fire in inputs.

**Step 6:** Commit: `"feat(dashboard): mount CustomizeModal with M keyboard shortcut"`

---

## Task 18: Full Integration Test

**Step 1:** Run `pnpm test` → ALL PASS

**Step 2:** Run `pnpm -r build` → ALL BUILD

**Step 3:** Manual smoke test:
1. `pnpm dev`, open http://localhost:4000
2. `npx tsx scripts/simulate_all_nodes.ts`
3. Press M → nothing happens (feature flag is off by default)
4. Open browser console: `localStorage.setItem('synapse-experimental-self-modify', 'true')` → reload
5. Press M → modal opens
6. Type "change accent to orange" → live preview (requires `ANTHROPIC_API_KEY` set)
7. Apply → reload → theme persists
8. Type "add a bar chart of tokens per agent" → custom lens tab appears
9. Reset to Default → factory state

**Step 4:** Commit any fixes: `"fix(dashboard): address integration issues from smoke test"`

---

## Summary

| Task | What | Notes |
|------|------|-------|
| 1 | Theme Variables Registry | Pure functions, no deps |
| 2 | CSS Sanitizer | String parsing, edge-case heavy |
| 3 | Safe Expression Evaluator | Recursive-descent parser |
| 4 | Customize Zod Schemas | Zod definitions |
| 5 | Core exports | One file edit |
| 6 | **Anthropic Client (from scratch)** | **No existing AI code to extract from** |
| 7 | Customize Service | Orchestrates validation pipeline |
| 8 | Customize Route + mount | Express route + app.ts wiring |
| 9 | CSS @theme block | One file edit |
| 10 | Component migration | ~37 files, mechanical find-replace |
| 11 | ThemeManager | localStorage + DOM manipulation |
| 12 | Pre-React init script | One file edit |
| 13 | Customize store state | Store fields + actions |
| 14 | CustomizeModal | Full modal component |
| 15 | CustomLens | Chart rendering, 7 chart types |
| 16 | LensPanel integration | Type + render changes |
| 17 | App.tsx integration | Shortcut + modal mount |
| 18 | Integration test | Manual testing |
