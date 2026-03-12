# Permission Card Stack — Design Spec

**Date**: 2026-03-12
**Status**: Ready for implementation

## Problem

Permission approval cards (AskUserQuestion, tool permissions) have several UX issues:

- Cards aren't big enough — long question text and many options are clipped with no scroll
- No way to dismiss a card without sending an explicit deny to Claude
- Plain vertical stack with no depth, animation, or swipe interaction
- Fixed 320px width is cramped for AskUserQuestion cards
- No visual priority when multiple cards accumulate

## Solution

iOS-style notification card stack with framer-motion spring physics. Bottom-center positioned, depth-layered, swipe-to-dismiss. Long content expands to a full-screen modal. Works on both desktop and mobile.

## Decisions

| Choice       | Selected                    | Alternatives considered                              |
| ------------ | --------------------------- | ---------------------------------------------------- |
| Card pattern | iOS notification stack      | Carousel/pager, bottom sheet stack                   |
| Position     | Bottom-center               | Bottom-left (current), bottom-right, top-center      |
| Long content | Expand to full-screen modal | Scroll within card only, truncate                    |
| Animation    | framer-motion               | Vanilla CSS transitions, @use-gesture + react-spring |
| Platform     | Both desktop and mobile     | Desktop only                                         |

---

## Architecture

### New files

| File                                         | Purpose                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `components/permissions/PermissionStack.tsx` | Stack container — depth layering, `AnimatePresence`, clear-all, positioning   |
| `components/permissions/PermissionCard.tsx`  | Refactored card — close X, scrollable content, drag-to-dismiss, modal trigger |
| `components/permissions/PermissionModal.tsx` | Full-screen modal for expanded card view                                      |

### Modified files

| File                               | Change                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `store/permissionStore.ts`         | Add `dismissedIds` Set + `dismiss(id)` action + sessionStorage persistence |
| `components/mobile/MobileView.tsx` | Swap `PermissionPanel` for `PermissionStack`                               |
| `App.tsx`                          | Swap `PermissionPanel` for `PermissionStack`                               |

### Deleted files

| File                                                | Reason                            |
| --------------------------------------------------- | --------------------------------- |
| `components/permissions/PermissionPanel.tsx`        | Replaced by `PermissionStack.tsx` |
| `components/permissions/PermissionApprovalCard.tsx` | Replaced by `PermissionCard.tsx`  |

### Dependencies

| Package         | Version | Size     | Purpose                                        |
| --------------- | ------- | -------- | ---------------------------------------------- |
| `framer-motion` | ^12     | ~30KB gz | Spring physics, drag gestures, AnimatePresence |

---

## Card Stack Behavior

### Depth effect

- Top card: full scale, full opacity
- Card behind (index 1): `scale(0.96)`, `translateY(8px)`, `opacity(0.85)`
- Card behind (index 2): `scale(0.92)`, `translateY(16px)`, `opacity(0.70)`
- Max 3 cards visible behind top card. Remaining hidden with "+N more" badge.

### Ordering

- Newest on top (reversed from current oldest-first)

### Entry animation

- Slide up from below + fade in via `AnimatePresence`
- Spring config: `{ stiffness: 300, damping: 30 }`

### Exit — swipe dismiss

- `motion.div` with `drag="x"` for horizontal swipe gesture
- Swipe **either direction** = local dismiss (no directional semantics) <!-- revised: P0 — swipe direction was ambiguous, both directions now mean dismiss -->
- Threshold: 40% of card width OR velocity > 500px/s
- Opacity fades proportionally as card moves (`useTransform` on drag x → opacity)
- On exit complete: card removed from render array

### Exit — X button

- Scale down + fade out
- Same dismiss semantics as swipe

### Close X button

- Top-right corner on **every** active card (not just expired)
- Dismiss = local hide only, does NOT send deny to Claude
- Tooltip on first use: "Swipe or tap X to hide — Claude waits until timeout" <!-- revised: P1 — user education for new dismiss concept -->

---

## Dismiss vs Deny

| Action                    | What happens                | Server effect                                                          |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| **X button / swipe**      | Card hidden locally         | None — permission stays pending, times out naturally                   |
| **Deny button**           | Card removed, deny sent     | `PUT /api/permissions/:id/decision` with `behavior: deny`              |
| **Approve / Send Answer** | Card removed, response sent | `PUT /api/permissions/:id/decision` with `behavior: allow` (+ answers) |

### Dismissed cards must not reappear on refresh <!-- revised: P0 — hydration race -->

`permissionStore` adds a `dismissedIds: Set<string>` persisted to `sessionStorage`:

- `dismiss(id)` adds to set + removes from `pending` array
- `hydrate(items)` filters out any IDs in `dismissedIds`
- On `permissionResolved` WS message, remove the ID from `dismissedIds` (cleanup)
- sessionStorage key: `synapse-dismissed-permissions`

---

## Content Sizing

### Default card

- Max height: `50vh`
- Layout: question text pinned top, action buttons pinned bottom, options area scrolls in between
- Width: `max-w-96` (384px) on desktop, `mx-4` (full width minus padding) on mobile

### Modal expansion trigger

- If options count > 5 OR question text overflows 3 lines, show expand affordance (corner icon)
- Double-tap card OR tap expand icon → opens `PermissionModal`

### PermissionModal

- Centered overlay with backdrop blur
- `max-w-[480px]`, `max-h-[80vh]`, scrollable content area
- Close via: X button, backdrop click, Escape key
- Focus trap: Tab cycles within modal, Escape closes <!-- revised: P1 — accessibility -->
- Same card content rendered at larger size

---

## Positioning

### Desktop

- `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-96`
- `pointer-events-none` on wrapper, `pointer-events-auto` on each card <!-- revised: P1 — prevent blocking graph interaction -->

### Mobile

- Same center positioning, `fixed bottom-16` (above tab bar)
- Touch events on cards use `stopPropagation` to prevent React Flow pan conflicts <!-- revised: P1 — touch conflict with graph -->

### Clear-all button <!-- revised: P1 — bulk dismiss affordance -->

- Appears when pending count > 2
- Positioned above the stack: small pill "Clear all (N)"
- Dismisses all cards locally (no deny sent)

---

## AnimatePresence Integration <!-- revised: P1 — exit animation timing -->

The store's `resolvePending()` must NOT remove items from the render array immediately. Instead:

1. `resolvePending(id, behavior)` moves item to `exiting` array (new field)
2. `PermissionStack` renders both `pending` and `exiting` items, with `exiting` items getting `exit` animation props
3. `AnimatePresence`'s `onExitComplete` callback calls `removeExited(id)` to clean up
4. This ensures the exit animation plays fully before the DOM node is removed

---

## framer-motion Config <!-- revised: P1 — inline drag config, no separate hook -->

Drag configuration is inline in `PermissionCard.tsx` (no separate `useSwipeDismiss` hook for v1):

```tsx
<motion.div
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}
  dragElastic={0.7}
  onDragEnd={(_, info) => {
    const threshold = cardWidth * 0.4;
    if (Math.abs(info.offset.x) > threshold || Math.abs(info.velocity.x) > 500) {
      onDismiss(id);
    }
  }}
  style={{ x, opacity: useTransform(x, [-200, 0, 200], [0, 1, 0]) }}
  // ...
/>
```

Spring config: `{ type: "spring", stiffness: 300, damping: 30 }`

---

## VS Code Extension <!-- revised: P1 — bundle size verification -->

framer-motion adds ~30KB gzipped to the dashboard bundle. Current `.vsix` is ~1.18MB (2.5% increase). The esbuild config in `apps/vscode` must:

- Bundle framer-motion's ESM entry correctly
- Verify no Node.js-only imports leak through (framer-motion is browser-safe)
- Test: `pnpm run package` in `apps/vscode` must succeed, `.vsix` size < 1.5MB

---

## Open Questions / Deferred (P2)

1. **Modal vs tall card**: Consider using only internal scroll (no modal) and reserving modal for 8+ options. Current design uses modal at 5+ options — may be too aggressive.
2. **Accessibility focus trap**: Could use `@headlessui/react` Dialog for production-grade focus management. Manual trap is fine for v1.
3. **Success metrics**: Track dismiss rate, approve/deny latency, timeout rate in `permission_events` table. Instrument after v1 ships.
4. **Haptic feedback**: On mobile, `navigator.vibrate(10)` on swipe threshold could add tactile satisfaction. Browser support varies.
