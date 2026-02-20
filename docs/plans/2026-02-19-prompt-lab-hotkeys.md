# Prompt Lab Hotkeys for VS Code Extension

## Context

The Synapse dashboard has a Prompt Lab (Workshop) that analyzes prompts and generates improved rewrites using two modes: **Developer** (precise, technical) and **Vibe** (creative, conversational). Currently this only works inside the dashboard webview. The goal is to expose this functionality via VS Code keybindings so users can select any text in any editor, press a hotkey, and get an improved rewrite in-place — plus add a settings UI for configuring the feature.

## Approach

Add two global VS Code commands with keybindings that call the existing `POST /api/analytics/ai-analyze-prompt` server endpoint, then replace the selected text with the `rewrite` field. Show score briefly in status bar. Add a new "Prompt Lab" tab to the settings panel for hotkey display, model selection, and behavior toggles.

**No server-side changes needed** — the existing endpoint, caching, rate limiting, and model selection all work as-is.

## Files to Modify

1. **`apps/vscode/package.json`** — add 2 commands, 2 keybindings, new settings properties
2. **`apps/vscode/src/extension.ts`** — register command handlers
3. **`apps/vscode/src/settingsPanel.ts`** — add "Prompt Lab" tab with settings UI

## Implementation Steps

### Step 1: Add commands, keybindings, and settings to package.json

**Commands** (add to `contributes.commands`):
```json
{ "command": "synapse.improveTextDev", "title": "Synapse: Improve Selection (Developer)" },
{ "command": "synapse.improveTextVibe", "title": "Synapse: Improve Selection (Vibe)" }
```

**Keybindings** (add `contributes.keybindings`):
```json
"keybindings": [
  { "command": "synapse.improveTextDev", "key": "ctrl+alt+d", "when": "editorHasSelection" },
  { "command": "synapse.improveTextVibe", "key": "ctrl+alt+v", "when": "editorHasSelection" }
]
```

**Settings** (add to `contributes.configuration.properties`):
```json
"synapse.promptLab.model": {
  "type": "string",
  "enum": ["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-6"],
  "enumDescriptions": ["Haiku 4.5 — fast, cheap", "Sonnet 4.5 — balanced", "Opus 4.6 — highest quality"],
  "default": "claude-sonnet-4-5-20250929",
  "description": "Default AI model for Prompt Lab hotkeys"
},
"synapse.promptLab.showScore": {
  "type": "boolean",
  "default": true,
  "description": "Show score in status bar after processing"
},
"synapse.promptLab.maxChars": {
  "type": "number",
  "default": 4000,
  "minimum": 100,
  "maximum": 10000,
  "description": "Maximum characters to send for analysis"
}
```

### Step 2: Add shared handler function in extension.ts

Create `improveSelectedText(mode: 'developer' | 'vibe')` that:

1. Gets `vscode.window.activeTextEditor` — warn and return if none
2. Gets `editor.selection` — warn and return if empty
3. Reads `editor.document.getText(selection)` — the selected text
4. Reads settings: model, showScore, maxChars from `vscode.workspace.getConfiguration('synapse')`
5. Clips text to `maxChars`
6. Checks server health via existing `checkServerHealth(port)` — if not reachable, offer "Start Server" action
7. Shows status bar spinner: `$(loading~spin) Improving...`
8. POSTs to `http://localhost:{port}/api/analytics/ai-analyze-prompt` with:
   ```json
   {
     "promptText": selectedText,
     "mode": "developer" | "vibe",
     "model": configuredModel,
     "skipCache": false,
     "sessionContext": { "model": "unknown", "toolCount": 0, "category": "general", "cost": 0 }
   }
   ```
9. Parses response JSON → extracts `data.rewrite`
10. If `rewrite` is empty or missing → show warning, keep original text
11. Calls `editor.edit(b => b.replace(selection, rewrite))` to replace in-place (single undo)
12. If `showScore` is true, updates status bar briefly with score:
    - Developer: `$(sparkle) 8/10`
    - Vibe: `$(sparkle) Nailed it!` / `Pretty good` / `Getting there` / `Needs work`
13. After 3 seconds, restores normal status bar text via `updateStatusBarMetrics()`
14. On error → show error notification, restore status bar

**HTTP helper** — add `httpPost(urlPath, body)` method alongside existing `httpGet` pattern (uses Node `http` module, already imported).

Register both commands:
```typescript
vscode.commands.registerCommand('synapse.improveTextDev', () => improveSelectedText('developer'));
vscode.commands.registerCommand('synapse.improveTextVibe', () => improveSelectedText('vibe'));
```

### Step 3: Add "Prompt Lab" tab to settings panel

Add a 4th tab to `settingsPanel.ts` (`getHtml()`):

**Tab bar**: Add `<div class="tab" data-tab="promptlab">Prompt Lab</div>`

**Tab content** (`tab-promptlab`):

1. **Keyboard Shortcuts card**
   - Show current keybindings: `Ctrl+Alt+D` → Developer, `Ctrl+Alt+V` → Vibe
   - "Customize Keybindings" button → opens VS Code's keyboard shortcuts editor filtered to `synapse.improveText`
   - Implementation: `send({ type: 'openKeybindings' })` → handler calls `vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'synapse.improveText')`

2. **Default Model card**
   - Dropdown (`<select>`) with 3 options: Haiku 4.5 / Sonnet 4.5 / Opus 4.6
   - Reads current value on load from VS Code settings
   - On change: `send({ type: 'setPromptLabSetting', key: 'model', value: selectedModelId })`
   - Handler calls `vscode.workspace.getConfiguration('synapse').update('promptLab.model', value, true)`

3. **Behavior card**
   - Checkbox: "Show score in status bar" (reads/writes `synapse.promptLab.showScore`)
   - Number input: "Max characters" (reads/writes `synapse.promptLab.maxChars`)

**Message handling** in `handleMessage()`:
```typescript
case 'getPromptLabSettings': {
  const config = vscode.workspace.getConfiguration('synapse');
  this.panel.webview.postMessage({
    type: 'promptLabSettings',
    data: {
      model: config.get('promptLab.model', 'claude-sonnet-4-5-20250929'),
      showScore: config.get('promptLab.showScore', true),
      maxChars: config.get('promptLab.maxChars', 4000),
    },
  });
  break;
}
case 'setPromptLabSetting': {
  const config = vscode.workspace.getConfiguration('synapse');
  await config.update(`promptLab.${msg.key}`, msg.value, true);
  break;
}
case 'openKeybindings': {
  vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'synapse.improveText');
  break;
}
```

### Implementation Notes

- Use Node `http` module (already imported) for the POST — no new dependencies
- The `port` comes from `serverManager?.port ?? 4000`
- Max chars enforced both client-side (clip before sending) and server-side (4000 cap)
- Status bar reuse: temporarily override `statusBarItem.text`, restore via `updateStatusBarMetrics()` after timeout
- `editorHasSelection` when clause prevents firing with no selection, but check defensively in handler
- VS Code keybinding customization is handled by VS Code's built-in UI — we just show defaults and link to the editor

## Verification

1. Start the Synapse server (`.\start-server.ps1` or auto-start)
2. Open any file, select some text
3. Press `Ctrl+Alt+D` → selection replaced with developer-mode rewrite, status bar shows score
4. Press `Ctrl+Z` → original text restored
5. Select text, press `Ctrl+Alt+V` → vibe-mode rewrite
6. Open Synapse Settings → Prompt Lab tab → change model to Haiku, verify next hotkey uses Haiku
7. Toggle "Show score" off → verify no status bar feedback after next hotkey
8. Click "Customize Keybindings" → VS Code keybinding editor opens filtered to Synapse commands
9. With server stopped: hotkey shows warning offering to start server
10. Build: `cd apps/vscode && pnpm run package` — no build errors
