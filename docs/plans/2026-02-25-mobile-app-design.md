# Synapse Mobile App — Design Document

**Date:** 2026-02-25
**Status:** Design approved, pending implementation plan

---

## Problem Statement

Synapse's web frontend has a working mobile-web view (`MobileView.tsx`) but it lacks the native capabilities that make mobile monitoring genuinely useful: push notifications when agents finish or error out, a home screen widget showing active agent count and cost at a glance, and the fluid feel of a real native app. This design covers building a native Expo mobile app that connects to the existing Synapse backend over local WiFi.

---

## Decisions

| Question     | Answer                                                                      |
| ------------ | --------------------------------------------------------------------------- |
| App type     | Native — Expo with Prebuild                                                 |
| Platforms    | iOS + Android                                                               |
| Connectivity | Local network (same WiFi as dev machine)                                    |
| Use case     | Monitoring only (read-only)                                                 |
| Key feature  | All equally: push notifications, native feel + gestures, home screen widget |
| Distribution | Small team via TestFlight (iOS) + Firebase App Distribution (Android)       |

---

## Architecture

### Repository Placement

New workspace package at `apps/mobile/` within the existing monorepo:

```
Synapse/
├── apps/
│   ├── dashboard/      # existing web frontend
│   ├── vscode/         # existing VS Code extension
│   └── mobile/         # NEW — Expo app
│       ├── app/        # Expo Router file-based screens
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       ├── widgets/    # iOS WidgetKit Swift extension
│       └── package.json
└── packages/
    └── core/           # @synapse-ai/core — shared types, already works in Expo
```

`@synapse-ai/core` is pure TypeScript with no DOM/Node dependencies, so it imports directly into the Expo app without modification.

### Expo Workflow

**Expo SDK 52 with Prebuild.** The managed workflow is used for development (`expo start`), but `npx expo prebuild` generates native `ios/` and `android/` project folders that are committed to the repo. This is required for:

- iOS home screen widgets (WidgetKit App Extension — Swift only, no JS)
- Android App Widgets (`react-native-android-widget`)
- Background WebSocket reconnect via native background task APIs
- Precise haptic feedback patterns (`expo-haptics`)

**Expo EAS** handles all builds and distribution:

```
eas build --platform ios    → TestFlight
eas build --platform android → Firebase App Distribution
eas update                   → OTA JS updates (no store re-submit for bug fixes)
```

### Hybrid Graph Rendering

The graph is the most complex view and already works well on mobile. Rather than rewriting React Flow in React Native, the graph screen embeds the existing `MobileGraphView.tsx` in a `WebView`:

```
Mobile Graph Screen
└── <WebView source={{ uri: `http://${serverHost}:4000/mobile-graph` }} />
    └── Served by Express: stripped-down React build (graph only, no nav)
```

The server gains a new route `/mobile-graph` that serves a minimal HTML shell that mounts only `MobileGraphView`. Communication between the WebView and native shell uses `postMessage` for selected-node events (to open the native detail sheet).

Everything else — analytics, session list, settings, navigation — is fully native React Native.

---

## Screens & Navigation

Navigation uses **Expo Router** (file-based, built on React Navigation). Bottom tab bar with 4 tabs.

### Tab 1: Dashboard (Home)

The first screen users see. At-a-glance status for all running sessions.

**Content:**

- Status bar chip: server connection status (green dot / red dot + "Reconnecting…")
- KPI row: active agents · total cost today · total tokens today
- Session list (FlatList): each row shows session title, agent count, elapsed time, running/done/error badge. Tap → Session Detail sheet.
- Pull-to-refresh (re-fetches `/api/events`)
- Empty state: "No sessions yet. Start a Claude Code session on your dev machine."

### Tab 2: Graph

Hybrid WebView containing the existing MobileGraphView. Native chrome around it:

- Native header with session filter pill (All / filter by session ID)
- WebView occupies full remaining space
- Tap a node in the graph → WebView posts message → native bottom sheet opens (Agent Detail)
- Native pinch gesture handler wraps the WebView for smooth zoom (WebView's own pinch is used as fallback)
- Pause/resume button (native, sends message to WebView to freeze updates)

### Tab 3: Lenses

Six lens visualizations. For Recharts-based lenses, render in a thin WebView shell (same approach as graph). For simpler data views, render natively.

| Lens       | Rendering                             |
| ---------- | ------------------------------------- |
| Heatmap    | WebView (Recharts)                    |
| Treemap    | WebView (Recharts)                    |
| Sankey     | WebView (Recharts)                    |
| Compaction | Native FlatList (simple enough)       |
| Cost       | Native bar chart via `victory-native` |
| Tree       | Native FlatList with indentation      |

A native segmented control / horizontal scroll picker at the top selects the active lens.

### Tab 4: Settings

- **Server URL** — text input, e.g. `http://192.168.1.42:4000`. Saved to `AsyncStorage`. Validated on save (attempts HTTP GET `/api/health`).
- **Notifications** — toggle per event type: agent finished, agent errored, session ended, agent needs input.
- **Widget refresh interval** — picker: 1 min / 5 min / 15 min (controls background fetch frequency).
- **About** — app version, build number, link to Synapse repo.

### Agent Detail Bottom Sheet

Appears when tapping any session row or graph node. Uses `@gorhom/bottom-sheet` with snap points at 40% (peek) and 92% (full).

**Peek state:** Agent name, status badge, elapsed time, token count, cost.

**Full state:** Adds tool call timeline (FlatList of tool pills), streaming text output (ScrollView auto-scrolls), stop button (sends `DELETE /api/agents/:id` — only available for running agents; app is read-only for data, but stopping an agent is a monitoring control action).

---

## Push Notifications

### Architecture

```
Claude Code hook event
    → POST /api/events (Express)
    → Backend normalizes event
    → Checks: does this event type have push subscribers?
    → Expo Push API (https://exp.host/--/api/v2/push/send)
    → APNs / FCM → device
```

The backend gains a new `push_subscriptions` table in SQLite:

```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  expo_push_token TEXT NOT NULL,
  event_types TEXT NOT NULL,  -- JSON array: ["agent_end","agent_error","session_end"]
  created_at INTEGER NOT NULL
);
```

New API endpoints:

- `POST /api/push/subscribe` — register Expo push token + event type preferences
- `DELETE /api/push/subscribe/:id` — unregister

### Notification Content

| Trigger                  | Title              | Body                                         |
| ------------------------ | ------------------ | -------------------------------------------- |
| `agent_end` (success)    | "Agent finished ✓" | "Explore agent completed in 2m 14s — $0.012" |
| `agent_error`            | "Agent failed"     | "Plan agent errored: Cannot read file…"      |
| `session_end`            | "Session ended"    | "Session ended — 4 agents, $0.08 total"      |
| `agent_start` (subagent) | "Subagent spawned" | "Bash agent started by Plan agent"           |

Notifications are rate-limited to 1 per agent per event type (no duplicate firing). Tapping a notification deep-links to the relevant session in the Dashboard tab.

### Expo Push Token Registration

On app launch, `expo-notifications` requests permission and retrieves the Expo push token. The token is posted to `POST /api/push/subscribe` with the server URL from Settings. On permission denial, notifications are silently disabled with a settings prompt shown.

---

## Home Screen Widget

### iOS (WidgetKit)

A Swift App Extension in `apps/mobile/widgets/SynapseWidget/`. The widget reads from an **App Group shared container** (`group.ai.synapse.widget`) populated by the React Native app via `expo-sharing` / native module.

The native module writes a small JSON file to the App Group on every WebSocket event:

```json
{
  "activeAgents": 3,
  "costToday": "0.14",
  "lastEvent": "Plan agent completed",
  "lastEventTime": 1740480000,
  "serverOnline": true
}
```

Widget displays two sizes:

- **Small** (2×2): active agent count (large number), cost today (small), green/red dot for server status.
- **Medium** (4×2): adds last event description and timestamp.

Widget refreshes via `TimelineReloadPolicy.atEnd` — the timeline entry expires after the configured interval (1/5/15 min from Settings).

### Android (App Widget)

Uses `react-native-android-widget`. Similar data from shared `AsyncStorage` (Android App Widgets can read from the app's storage directly via a BroadcastReceiver). Widget layout mirrors the iOS small widget.

---

## Real-time Data Flow

```
Express server (port 4000)
    ↓ WebSocket (ws://)
React Native app (wsClient.ts)
    ↓ dispatches to Zustand store
    ↓ updates UI via React re-renders
    ↓ writes widget JSON file → App Group (iOS) / AsyncStorage (Android)
    ↓ schedules local notification if event matches user preferences
```

The mobile app's `wsClient` is a simplified port of the web frontend's `wsClient.ts`. It:

- Connects on foreground, disconnects on background (saves battery)
- Reconnects with exponential backoff (1s → 2s → 4s → max 30s)
- On reconnect, fetches `/api/events` to re-sync state (same as web)
- Uses `AppState` listener to detect foreground/background transitions

---

## State Management

Zustand store (`stores/agentStore.ts`) — a simplified subset of the web frontend's store. No React Flow nodes/edges needed (the graph runs in WebView). The mobile store tracks:

```typescript
interface MobileAgentStore {
  sessions: SessionData[];
  agents: AgentData[];
  events: AgentEvent[]; // last 200 events (ring buffer)
  selectedSessionId: string | null;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  serverUrl: string; // from AsyncStorage
  isPaused: boolean;

  // Actions
  setServerUrl(url: string): void;
  selectSession(id: string | null): void;
  togglePause(): void;
  handleEvent(event: AgentEvent): void;
}
```

---

## Performance Considerations

**WebSocket on mobile:** Battery and radio usage. The ws connection is only held while the app is in the foreground. On background, the app disconnects and uses background fetch (configured via `expo-background-fetch`) to poll `/api/events` at the widget refresh interval, primarily to keep the widget data current.

**Graph WebView memory:** The WebView is unmounted when the Graph tab is not active (same pattern as the existing web MobileView tab unmounting). This prevents React Flow's canvas from consuming memory while viewing analytics.

**Event ring buffer:** The store retains only the last 200 events in memory. On reconnect it fetches fresh from the API rather than accumulating unbounded history.

**FlatList virtualization:** All long lists (session list, tool call timeline) use `FlatList` with `initialNumToRender={10}` and `maxToRenderPerBatch={5}`. Item heights are fixed where possible to enable `getItemLayout` optimization.

**Chart rendering:** Victory Native renders charts using React Native Skia (hardware-accelerated). Recharts-in-WebView lenses are lazy-loaded (WebView not mounted until tab is selected).

---

## Server-Side Changes

The Express backend needs minimal additions:

1. **`/mobile-graph` route** — serves a stripped-down HTML page that mounts only `MobileGraphView.tsx`. Built as a separate Vite entry point or injected from the existing bundle.
2. **`/api/push/subscribe` + `DELETE`** — push token registration.
3. **Push notification sender** — new `pushService.ts` that calls the Expo Push API. Triggered from the event normalization pipeline after storing to SQLite.
4. **`/api/health`** — simple `200 OK` JSON response for connectivity checks from the mobile settings screen. (Likely already exists or trivial to add.)

The `push_subscriptions` table is added via a migration in `packages/server/src/db.ts`.

---

## Development Setup

```bash
# Install Expo CLI
npm install -g eas-cli

# Install mobile app deps
cd apps/mobile
pnpm install

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android

# Build for TestFlight
eas build --platform ios --profile preview

# Build for Firebase App Distribution
eas build --platform android --profile preview

# OTA update (JS-only changes, no native rebuild)
eas update --branch preview
```

---

## What's Intentionally Out of Scope

- **Agent spawning** — monitoring focus only (consistent with existing MobileView)
- **Snapshot export/import** — desktop workflow
- **Tool log panel** — power-user feature, not suited for mobile
- **Siri / voice control** — not worth the effort at this stage
- **Offline mode** — app requires LAN connection to function
- **iPad-specific layout** — treated as large phone for now
- **Dark mode toggle** — follows system appearance via Tailwind's `dark:` classes in WebView, and system dark mode in native components

---

## Open Questions / Risks

| Question                                                                     | Impact                                        | Resolution                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| How does the mobile app discover the server IP?                              | High — user must type it manually in Settings | Acceptable for v1; mDNS/Bonjour auto-discovery is a v2 enhancement    |
| iOS App Group setup requires Apple Developer account                         | Medium                                        | User needs $99/yr dev account for TestFlight anyway; this is included |
| WebView graph performance on older Android devices                           | Medium                                        | React Flow is canvas-based and generally performant; acceptable risk  |
| Expo SDK 52 WidgetKit support is via third-party library (`expo-widget-kit`) | Medium                                        | Can fall back to pure Swift App Extension if library is unstable      |
| Push notifications require device (not simulator)                            | Low                                           | Development/testing on physical device for notification flows         |
