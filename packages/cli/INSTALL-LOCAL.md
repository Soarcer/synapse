# Synapse — Local Install Guide

Real-time agent observability for Claude Code. See what your agents are actually doing.

## Step 1: Run synapse-setup.cmd

Double-click `synapse-setup.cmd` before anything else. It walks you through:

1. **Node.js check** — Synapse requires Node.js 20+. If it's not installed, the script offers to download and run the Node.js installer for you.
2. **Firewall ports (optional)** — If you want to approve Claude Code permissions from your phone or another device on your network (remote approval), the script asks permission to open firewall ports 27246-27248 for incoming TCP. This requires admin. If you only plan to use Synapse from localhost, you can skip this.
3. **PATH setup** — Adds the Synapse folder to your user PATH so the `synapse` command works from any terminal.

## Step 2: Install

Open a **Command Prompt** (cmd.exe, not PowerShell — npm scripts may be blocked by PowerShell's execution policy).

Run from the folder containing the tarball:

```cmd
npm install -g .\synapse-ai-cli-0.1.1.tgz
```

## Step 3: Run

Open a Command Prompt in the project folder you want to monitor:

```cmd
synapse start
```

If `synapse` isn't found on PATH, use the full path:

```cmd
"%APPDATA%\npm\synapse" start
```

Three things happen:

1. The Synapse server starts on your machine
2. Claude Code hooks are configured for this project
3. The dashboard opens in your browser

**Important:** Hooks only take effect for new Claude Code sessions. Any sessions already running won't be monitored. Start a new Claude Code session after running `synapse start`. In VS Code, press `Ctrl+Shift+P` → "Developer: Reload Window" to pick up the new hooks.

> **Remote approval (phone/LAN):** Start with `synapse start --lan` instead, then open `http://<your-pc-ip>:27246` on your phone or another device. Requires firewall setup from Step 1.

### Monitor multiple projects

Start the daemon from your first project, then hook additional projects:

```cmd
cd C:\Projects\project-a
synapse start -d

cd C:\Projects\project-b
synapse hook
```

All projects feed into the same dashboard.

## Commands

| Command | Description |
|---|---|
| `synapse start` | Start server + hook current project + open browser |
| `synapse start -d` | Start as background daemon |
| `synapse start --lan` | Bind to 0.0.0.0 (LAN/remote approval) |
| `synapse start --no-hook` | Start without hooking current project |
| `synapse start --observe-only` | Monitor only, no permission interception |
| `synapse stop` | Stop the running server |
| `synapse status` | Show URL, PID, and hook status |
| `synapse open` | Open dashboard in browser |
| `synapse hook` | Hook current project to running server |
| `synapse unhook` | Remove hooks from current project |
| `synapse setup` | One-time firewall setup for LAN/remote approval |

If `synapse` isn't on PATH, replace it with `"%APPDATA%\npm\synapse"` in all commands above.

## Stop

Press `Ctrl+C` in the terminal, or from any terminal:

```cmd
synapse stop
```

## Uninstall

```cmd
npm uninstall -g @synapse-ai/cli
```
