# Prompt Workshop

## Overview

The Prompt Workshop is a proactive prompt improvement tool in the Synapse Analytics dashboard. Users draft a rough prompt, get an AI-powered rewrite via Claude Haiku, and can send the improved version directly to a Claude Code terminal in VS Code.

This transforms the existing retroactive prompt analysis (Prompts tab) into a proactive workflow: improve before sending, not analyze after the fact.

## Why This Matters: The ROI

A single Haiku coaching call costs ~$0.003. A single wasted Opus 4.6 turn costs $0.20-$1.25. If the improved prompt prevents even one unnecessary turn, the ROI is **50x-625x**.

| Metric | Value |
|--------|-------|
| Cost per Haiku analysis | $0.002 - $0.004 |
| Cost per wasted Opus turn | $0.20 - $1.25 |
| Break-even threshold | Saving <1 Opus output token |
| Cascading savings (fewer turns = shorter history) | $0.20 - $0.50 per session |

Beyond token savings, better prompts reduce developer wait time, prevent context pollution, delay compaction, and produce higher-quality first-attempt code.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard (Browser)                                         │
│  Analytics → Workshop Tab                                    │
│                                                              │
│  [Textarea] → "Improve" → POST /api/analytics/ai-analyze-prompt
│                              (reuses existing Haiku endpoint) │
│                                                              │
│  [Result] → "Copy"   → navigator.clipboard.writeText()       │
│           → "Send"   → POST /api/analytics/workshop/send-to-terminal
│           → "Edit"   → loads rewrite back into textarea       │
└──────────────────────────────┬────────────────────────────────┘
                               │
                    REST POST  │  { text: string }
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Synapse Server                                               │
│                                                               │
│  /api/analytics/workshop/send-to-terminal                     │
│    → broadcaster.broadcastTerminalSend(text)                  │
│    → returns { sent: true/false, clientCount: N }             │
└──────────────────────────────┬────────────────────────────────┘
                               │
                    WebSocket  │  { type: 'terminal_send', data: { text } }
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  VS Code Extension                                            │
│                                                               │
│  ExtensionWsClient.onTerminalSend(text)                       │
│    → vscode.commands.executeCommand('synapse.sendToClaudeTerminal')
│    → findClaudeTerminal() — searches vscode.window.terminals  │
│    → terminal.sendText(text, false) — types WITHOUT Enter     │
│    → User reviews, presses Enter to submit                    │
│                                                               │
│  Fallback: if no Claude terminal found → clipboard + notify   │
└──────────────────────────────────────────────────────────────┘
```

The key design decision is **server-side WebSocket relay** rather than iframe `postMessage`. The analytics page runs as a top-level browser window (`?view=analytics`), not inside a VS Code iframe, so direct `postMessage` to the extension host is not possible. The WS relay works universally from any client.

## User Flow

1. Open Analytics dashboard → click **Workshop** tab
2. Toggle **Developer** or **Vibe** mode (shared with Prompts tab)
3. Type a rough prompt in the textarea
4. Press **Ctrl+Enter** or click **Improve**
5. Review the AI analysis: score, explanation, and improved prompt
6. Choose an action:
   - **Copy** — copies the improved prompt to clipboard
   - **Send to Claude** — types it into the Claude Code terminal (VS Code extension must be running)
   - **Edit** — loads the rewrite back into the textarea for iteration
7. Previous workshops are saved in the **History** sidebar (localStorage, max 20 items)

## Files

### New Files

| File | Purpose |
|------|---------|
| `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx` | Main Workshop UI component |
| `apps/dashboard/src/components/analytics/shared/formatMarkdown.tsx` | Shared markdown formatters (extracted from PromptAnalyzer) |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/types/agent.ts` | Added `terminal_send` variant to `WsServerMessage` union |
| `packages/server/src/services/broadcaster.ts` | Added `broadcastTerminalSend()` method |
| `packages/server/src/routes/analytics.ts` | Added `POST /api/analytics/workshop/send-to-terminal` endpoint; accepts `Broadcaster` param |
| `packages/server/src/app.ts` | Passes `broadcaster` to `createAnalyticsRouter()` |
| `apps/vscode/package.json` | Registered `synapse.sendToClaudeTerminal` command |
| `apps/vscode/src/extension.ts` | Added command handler, `findClaudeTerminal()` helper, WS listener |
| `apps/vscode/src/wsClient.ts` | Added `onTerminalSend` event emitter for `terminal_send` messages |
| `apps/dashboard/src/components/analytics/AnalyticsPage.tsx` | Added Workshop tab, shared mode toggle |
| `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx` | Updated imports to use shared formatters |

## API Endpoints

### POST /api/analytics/ai-analyze-prompt (existing, reused)

Used by the Workshop to get AI analysis of the draft prompt.

**Request:**
```json
{
  "promptText": "add auth to the express api",
  "mode": "developer",
  "skipCache": false,
  "sessionContext": {
    "model": "unknown",
    "toolCount": 0,
    "category": "general",
    "cost": 0
  }
}
```

**Response:**
```json
{
  "data": {
    "score": 4,
    "explanation": "The prompt is vague about what kind of auth...",
    "rewrite": "Implement JWT authentication for the Express API with...",
    "estimatedSavings": "Could save 2-3 exploratory turns",
    "historyComparison": "More specific than average"
  }
}
```

### POST /api/analytics/workshop/send-to-terminal (new)

Broadcasts the improved prompt to all connected WS clients (VS Code extension picks it up).

**Request:**
```json
{
  "text": "Implement JWT authentication for the Express API with..."
}
```

**Response (success):**
```json
{
  "sent": true,
  "clientCount": 2
}
```

**Response (no clients):**
```json
{
  "sent": false,
  "clientCount": 0,
  "reason": "no_clients"
}
```

## WebSocket Message

```typescript
// Added to WsServerMessage union in @synapse-ai/core
{ type: 'terminal_send'; data: { text: string } }
```

## VS Code Extension

### Command: `synapse.sendToClaudeTerminal`

- Searches `vscode.window.terminals` for a terminal whose name contains "claude" (case-insensitive)
- Calls `terminal.show()` then `terminal.sendText(text, false)` — types the text WITHOUT pressing Enter
- The user reviews the text in the terminal and presses Enter to submit
- If no Claude terminal is found: copies to clipboard via `vscode.env.clipboard.writeText()` and shows a notification

### Terminal Detection

```typescript
function findClaudeTerminal(): vscode.Terminal | undefined {
  for (const terminal of vscode.window.terminals) {
    if (terminal.name.toLowerCase().includes('claude')) return terminal;
  }
  return undefined;
}
```

The Claude Code VS Code extension names its terminal "Claude", making detection reliable. The `sendText(text, false)` call types the text without pressing Enter, giving the user full control over submission.

## localStorage Keys

| Key | Purpose | Max Size |
|-----|---------|----------|
| `synapse-workshop-history` | Array of past workshop results | 20 items |
| `synapse-ai-analysis-mode` | Developer or Vibe mode (shared with Prompts tab) | 1 string |

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| Ctrl+Enter | Workshop textarea focused | Trigger "Improve" |

## Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| No API key configured | Error message: "Analysis failed — is an API key configured?" |
| No VS Code extension connected | Copies to clipboard + shows yellow toast notification |
| No Claude terminal found | Copies to clipboard + shows VS Code notification |
| Network error on improve | Error message displayed, can retry |
| Network error on send | Falls back to clipboard copy |
