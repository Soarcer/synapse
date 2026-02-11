import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { normalizeOpenClawJsonl } from '../normalizers/openclawJsonl.js';
import type { PluginLogger, TranscriptLine } from '../types.js';

const POLL_INTERVAL_MS = 500;
const DEBOUNCE_MS = 100;

/**
 * Layer 1: Watches OpenClaw JSONL transcript files and forwards events
 * to the Synapse server via POST /api/events/batch.
 */
export class JsonlBridge {
  private port: number;
  private logger: PluginLogger;
  private watchers: fs.FSWatcher[] = [];
  private fileOffsets = new Map<string, number>();
  private pollTimers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(port: number, logger: PluginLogger) {
    this.port = port;
    this.logger = logger;
  }

  /**
   * Watch an agents directory (e.g., ~/.openclaw/agents/).
   * Discovers all agent subdirs and watches their session directories.
   */
  watchAgentsDir(agentsDir: string): void {
    if (!fs.existsSync(agentsDir)) {
      this.logger.warn(`[JsonlBridge] Agents directory not found: ${agentsDir}`);
      return;
    }

    // Discover existing agents
    const agentDirs = this.discoverAgentDirs(agentsDir);
    for (const { agentId, sessionsDir } of agentDirs) {
      this.watchSessionsDir(agentId, sessionsDir);
    }

    // Watch for new agents appearing
    try {
      const watcher = fs.watch(agentsDir, { persistent: false }, (eventType, filename) => {
        if (this.stopped || !filename) return;
        const agentDir = path.join(agentsDir, filename, 'sessions');
        if (fs.existsSync(agentDir)) {
          this.watchSessionsDir(filename, agentDir);
        }
      });
      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn(`[JsonlBridge] Cannot watch ${agentsDir}: ${err}`);
    }

    this.logger.info(`[JsonlBridge] Watching ${agentDirs.length} agent(s) in ${agentsDir}`);
  }

  /**
   * Discover agent subdirectories containing session files.
   */
  private discoverAgentDirs(agentsDir: string): Array<{ agentId: string; sessionsDir: string }> {
    const results: Array<{ agentId: string; sessionsDir: string }> = [];
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionsDir = path.join(agentsDir, entry.name, 'sessions');
        if (fs.existsSync(sessionsDir)) {
          results.push({ agentId: entry.name, sessionsDir });
        }
      }
    } catch (err) {
      this.logger.warn(`[JsonlBridge] Error scanning ${agentsDir}: ${err}`);
    }
    return results;
  }

  /**
   * Watch a specific agent's sessions directory for JSONL files.
   */
  private watchSessionsDir(agentId: string, sessionsDir: string): void {
    // Process existing JSONL files
    try {
      const files = fs.readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(sessionsDir, f));

      for (const file of files) {
        this.tailFile(agentId, file);
      }
    } catch (err) {
      this.logger.warn(`[JsonlBridge] Error reading ${sessionsDir}: ${err}`);
    }

    // Watch for new files and changes
    try {
      const watcher = fs.watch(sessionsDir, { persistent: false }, (eventType, filename) => {
        if (this.stopped || !filename || !filename.endsWith('.jsonl')) return;
        const filepath = path.join(sessionsDir, filename);
        // Debounce rapid events
        setTimeout(() => {
          if (!this.stopped) this.tailFile(agentId, filepath);
        }, DEBOUNCE_MS);
      });
      this.watchers.push(watcher);
    } catch (err) {
      this.logger.warn(`[JsonlBridge] Cannot watch ${sessionsDir}: ${err}`);
    }

    // Periodic poll as fallback (fs.watch can miss events on some platforms)
    const timer = setInterval(() => {
      if (this.stopped) return;
      try {
        const files = fs.readdirSync(sessionsDir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => path.join(sessionsDir, f));
        for (const file of files) {
          this.tailFile(agentId, file);
        }
      } catch { /* directory may have been removed */ }
    }, POLL_INTERVAL_MS * 10); // Poll every 5 seconds as backup

    this.pollTimers.push(timer);
  }

  /**
   * Read new lines from a JSONL file starting from the last known offset.
   */
  private tailFile(agentId: string, filepath: string): void {
    try {
      const stat = fs.statSync(filepath);
      const offset = this.fileOffsets.get(filepath) ?? 0;

      if (stat.size <= offset) return; // No new data

      const stream = fs.createReadStream(filepath, {
        start: offset,
        encoding: 'utf-8',
      });

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      const sessionFile = path.basename(filepath, '.jsonl');
      const newEvents: unknown[] = [];

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const parsed = JSON.parse(line) as TranscriptLine;
          const events = normalizeOpenClawJsonl(parsed, { agentId, sessionFile });
          for (const event of events) {
            newEvents.push(event);
          }
        } catch {
          // Skip unparseable lines
        }
      });

      rl.on('close', () => {
        this.fileOffsets.set(filepath, stat.size);
        if (newEvents.length > 0) {
          this.sendEvents(newEvents);
        }
      });
    } catch {
      // File may have been deleted between check and read
    }
  }

  /**
   * Send normalized events to the Synapse server.
   * Uses a batch endpoint to reduce HTTP overhead.
   */
  private async sendEvents(events: unknown[]): Promise<void> {
    try {
      // Send each event individually to the existing /api/events POST endpoint
      // The server treats these as pre-normalized because they have eventSource='openclaw'
      for (const event of events) {
        await fetch(`http://localhost:${this.port}/api/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        });
      }
    } catch (err) {
      this.logger.warn(`[JsonlBridge] Failed to send ${events.length} events: ${err}`);
    }
  }

  /**
   * Stop all file watchers and timers.
   */
  stop(): void {
    this.stopped = true;
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    for (const timer of this.pollTimers) {
      clearInterval(timer);
    }
    this.watchers = [];
    this.pollTimers = [];
    this.logger.info('[JsonlBridge] Stopped');
  }
}
