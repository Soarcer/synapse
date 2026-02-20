# VS Code Extension Integration Patterns — Quick Reference

A concise guide to common VS Code extension capabilities. Use this as a reference when adding features to an existing extension.

---

## 1. Reading Selected Text from the Active Editor

Use `vscode.window.activeTextEditor` to access the current editor. The `selection` property gives you the highlighted range, and `document.getText(selection)` returns the selected string.

If no editor is open or nothing is selected, handle gracefully with a warning message.

---

## 2. Replacing Selected Text In-Place

Use `editor.edit(editBuilder => editBuilder.replace(selection, newText))`. This creates a **single undoable operation**, so `Ctrl+Z` restores the original. The edit is async and returns a boolean indicating success.

For read-only editors (e.g., output panels), the edit will fail — check `editor.document.isUntitled` or catch the error.

---

## 3. Registering Commands

Define commands in `package.json` under `contributes.commands` with a `command` ID and `title`. Then in your `activate()` function, use `vscode.commands.registerCommand(id, handler)` and push the disposable to `context.subscriptions`.

You can register commands in a loop (e.g., `runPrompt1` through `runPrompt8`) with a factory pattern that maps the number to a configuration entry.

---

## 4. Keyboard Shortcuts (Keybindings)

Define in `package.json` under `contributes.keybindings`. Each entry has `command`, `key` (Windows/Linux), `mac`, and an optional `when` clause.

Useful `when` clauses:
- `editorHasSelection` — only fires when text is highlighted
- `editorTextFocus` — only when an editor has focus (not sidebar/terminal)
- `editorLangId == markdown` — restrict to specific file types

Shortcut conflicts: Check VS Code's Keyboard Shortcuts UI (`Ctrl+K Ctrl+S`) to verify your bindings don't collide with built-ins. `Ctrl+Shift+<number>` slots are mostly available.

---

## 5. Quick Pick Menus

`vscode.window.showQuickPick(items, options)` shows a searchable dropdown. Each item can have `label`, `description` (shown right-aligned), and `detail` (shown below). Returns the selected item or `undefined` if cancelled.

Use this for letting users choose from a list of configured options (e.g., prompt templates, backends, actions).

---

## 6. Input Boxes

`vscode.window.showInputBox(options)` shows a single-line text input. Key options: `prompt` (label text), `placeHolder`, `value` (pre-filled), and `validateInput` (function returning an error string or `null`). Returns the entered string or `undefined` if cancelled.

Good for ad-hoc/one-off user input like custom prompts or search terms.

---

## 7. Extension Settings (Configuration)

Define a settings schema in `package.json` under `contributes.configuration.properties`. Each property has a type, default, description, and optional enum for dropdowns.

Read settings at runtime with `vscode.workspace.getConfiguration('yourPrefix').get('key')`. Settings can be workspace-scoped or user-scoped. For sensitive values like API keys, prefer reading from environment variables first, then falling back to settings.

Settings support complex types including arrays of objects — useful for user-defined prompt lists, backend configs, etc.

---

## 8. Status Bar Items

Create with `vscode.window.createStatusBarItem(alignment, priority)`. Set `.text` (supports `$(icon-name)` for Codicons), `.tooltip`, `.command` (click action), then call `.show()`.

The spinning loader icon is `$(loading~spin)`. Use it during async operations and swap to `$(check)` or `$(error)` on completion. Dispose the item in your deactivate or via `context.subscriptions`.

---

## 9. Making HTTP/API Calls

VS Code extensions run in Node.js, so you can use the global `fetch()` (Node 18+), or `https` module, or install `node-fetch`. No special VS Code API needed.

Pattern for AI backend calls:
- Build the request body matching the provider's API format
- Send POST with appropriate headers (API key, content-type)
- Extract the text response from the provider-specific JSON structure
- Wrap in try/catch; surface errors as VS Code notification messages, never silently fail

For local backends (like Ollama), the call is identical but to `localhost` with no auth headers.

---

## 10. Notifications & Error Handling

Three levels:
- `vscode.window.showInformationMessage()` — blue info
- `vscode.window.showWarningMessage()` — yellow warning
- `vscode.window.showErrorMessage()` — red error

All three accept optional action buttons as additional string arguments and return a promise resolving to the clicked button label.

Best practice: never replace user text if the API call fails. Show the error and leave the original text intact.

---

## 11. Multi-Command Pattern with Shared Logic

When you have multiple commands that do the same thing with different parameters (e.g., 8 prompt shortcuts), use a shared handler function and register commands in a loop. The loop index or a config lookup determines which parameter set to use.

This avoids duplicating logic and makes it easy to add/remove command slots.

---

## 12. Extension Lifecycle

- `activate(context)` is called when any registered command is first invoked (or on startup if configured). Register all commands, create status bar items, initialize state here.
- `deactivate()` is called on extension unload. Clean up timers, connections, etc. Disposables pushed to `context.subscriptions` are auto-disposed.
- Use `activationEvents` in `package.json` to control when your extension loads. `onCommand:yourCommand` is the most common — the extension only loads when the command is triggered.

---

## 13. Bundling & Packaging

- Use `esbuild` or `webpack` to bundle your TypeScript into a single JS file for fast loading
- `vsce package` creates a `.vsix` file for local install or marketplace publishing
- `.vscodeignore` controls what goes into the package (exclude `src/`, `node_modules/`, tests)
- For local-only use, `vsce package` → `code --install-extension your-extension.vsix`

---

## 14. Testing During Development

Press `F5` in the extension project to launch an **Extension Development Host** — a second VS Code window with your extension loaded. Console output appears in the Debug Console of the original window. Changes require reloading the dev host (`Ctrl+R` in that window).

---

## Common Pitfalls

- **Forgetting `when` clauses**: Shortcuts without `when: "editorHasSelection"` fire even with no selection, leading to empty-string API calls.
- **Not awaiting `editor.edit()`**: The edit is async. If you don't await it, subsequent code may run before the replacement happens.
- **API keys in settings.json committed to git**: Prefer environment variables or VS Code's `SecretStorage` API for credentials.
- **Large selections / token limits**: Consider warning the user or truncating if selected text exceeds a threshold (e.g., 50,000 chars).
- **Shortcut conflicts on Mac**: `Cmd+Shift+<number>` may conflict with system or other extension shortcuts. Test on target platform.