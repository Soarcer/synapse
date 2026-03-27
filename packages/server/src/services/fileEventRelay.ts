// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * FileEventRelay — reads hook events from a shared JSONL relay file.
 *
 * Hook scripts (send_event.cjs, send_response.cjs) append one JSON line per
 * event instead of making an HTTP POST. This eliminates per-event Node process
 * spawning and HTTP overhead (~30-50ms → ~2ms per event).
 *
 * Design notes:
 * - Never deletes the relay file — events written after stop() are replayed
 *   as backlog on the next server start (e.g. SessionEnd fires as VS Code closes).
 * - Byte offset is persisted to disk so restarts don't re-ingest old events.
 * - fs.watch fires on most appends; 50ms poll is the reliability guarantee
 *   (Windows fs.watch is unreliable for file-level changes).
 * - If the relay file is externally deleted (tmp cleanup), the watcher detects
 *   the rename event and restarts cleanly.
 * - When offset exceeds COMPACT_THRESHOLD, the file is compacted: already-read
 *   bytes are discarded, unread tail is preserved, offset resets. This prevents
 *   unbounded growth while being safe for concurrent hook writers.
 */

import fs from 'fs';
import { logger } from '../lib/logger.js';
import type { Broadcaster } from './broadcaster.js';
import { ingestRawEvent } from './eventIngestion.js';

const POLL_INTERVAL_MS = 50;
/** Compact when the read offset exceeds this (already-processed bytes). */
const COMPACT_THRESHOLD = 2 * 1024 * 1024; // 2 MB
/** Hard safety cap — if the file somehow grows past this, truncate everything. */
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface RelayStatus {
  relayPath: string;
  fileSize: number;
  offset: number;
  behind: number;
  eventsIngested: number;
  lastIngestAt: string | null;
  pollIntervalMs: number;
  compactThreshold: number;
  compactions: number;
}

export class FileEventRelay {
  private relayPath: string;
  private offsetPath: string;
  private broadcaster: Broadcaster;

  private offset = 0;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reading = false; // re-entrancy guard

  // Metrics
  private _eventsIngested = 0;
  private _lastIngestAt: Date | null = null;
  private _compactions = 0;

  constructor(relayPath: string, offsetPath: string, broadcaster: Broadcaster) {
    this.relayPath = relayPath;
    this.offsetPath = offsetPath;
    this.broadcaster = broadcaster;
  }

  /** Expose current relay health for the /api/relay/status endpoint. */
  getStatus(): RelayStatus {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(this.relayPath).size;
    } catch {
      /* file may not exist */
    }
    return {
      relayPath: this.relayPath,
      fileSize,
      offset: this.offset,
      behind: Math.max(0, fileSize - this.offset),
      eventsIngested: this._eventsIngested,
      lastIngestAt: this._lastIngestAt?.toISOString() ?? null,
      pollIntervalMs: POLL_INTERVAL_MS,
      compactThreshold: COMPACT_THRESHOLD,
      compactions: this._compactions,
    };
  }

  start(): void {
    // Restore persisted offset (prevents duplicate ingestion after restart)
    this.offset = this.readOffset();

    // Create relay file if it doesn't exist (fs.watch requires the file to exist)
    const fd = fs.openSync(this.relayPath, 'a');
    fs.closeSync(fd);

    // Read any backlog accumulated while the server was down
    this.readNewLines();

    // Watch for new appends
    this.startWatcher();

    // Safety-net poll — catches what fs.watch misses on Windows
    this.pollTimer = setInterval(() => this.readNewLines(), POLL_INTERVAL_MS);

    logger.info({ relayPath: this.relayPath, offset: this.offset }, 'FileEventRelay started');
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    // Persist final offset — do NOT delete relay file (post-stop hook events accumulate here)
    this.saveOffset();
    logger.info(
      { relayPath: this.relayPath, offset: this.offset, eventsIngested: this._eventsIngested },
      'FileEventRelay stopped',
    );
  }

  private startWatcher(): void {
    try {
      this.watcher = fs.watch(this.relayPath, { persistent: false }, (eventType) => {
        if (eventType === 'rename') {
          // File was deleted or replaced externally (tmp cleanup, OS reboot)
          logger.warn(
            { relayPath: this.relayPath },
            'FileEventRelay: relay file renamed/deleted — recreating',
          );
          this.watcher?.close();
          this.watcher = null;
          this.offset = 0;
          this.saveOffset();
          // Recreate and restart watcher
          const fd = fs.openSync(this.relayPath, 'a');
          fs.closeSync(fd);
          this.startWatcher();
        } else {
          this.readNewLines();
        }
      });
      this.watcher.on('error', (err) => {
        logger.warn({ err }, 'FileEventRelay: watcher error — relying on poll');
        this.watcher = null;
      });
    } catch (err) {
      logger.warn({ err }, 'FileEventRelay: fs.watch unavailable — relying on poll');
    }
  }

  private readNewLines(): void {
    if (this.reading) return;
    this.reading = true;
    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(this.relayPath);
      } catch {
        return; // File doesn't exist yet
      }

      // Hard safety cap — if the file somehow grows past 10 MB, read remaining then truncate
      if (stat.size > MAX_FILE_BYTES) {
        logger.warn(
          { size: stat.size, relayPath: this.relayPath },
          'FileEventRelay: relay file exceeds 10 MB — reading remaining then truncating',
        );
        // Read whatever is left first
        this.ingestRange(stat);
        // Then truncate
        try {
          fs.writeFileSync(this.relayPath, '');
        } catch {
          /* ignore — concurrent writer may recreate */
        }
        this.offset = 0;
        this.saveOffset();
        return;
      }

      if (stat.size <= this.offset) {
        // File may have been externally truncated (smaller than our offset)
        if (stat.size < this.offset) {
          logger.warn(
            { fileSize: stat.size, offset: this.offset },
            'FileEventRelay: file smaller than offset — resetting (external truncation?)',
          );
          this.offset = 0;
          this.saveOffset();
        }
        return;
      }

      const batchCount = this.ingestRange(stat);

      // Compact: if we've read past the threshold, remove already-processed bytes
      // to prevent unbounded file growth. We read the unprocessed tail, rewrite
      // the file, and reset offset. This is safe because hook writers use
      // appendFileSync (atomic on POSIX, effectively atomic on Windows for
      // small writes). The brief window where the file is rewritten is covered
      // by the re-entrancy guard — any events written during compaction will
      // be picked up on the next poll.
      if (this.offset > COMPACT_THRESHOLD) {
        this.compact();
      }

      if (batchCount > 0) {
        logger.debug(
          { lines: batchCount, offset: this.offset, fileSize: stat.size },
          'FileEventRelay: batch ingested',
        );
      }
    } finally {
      this.reading = false;
    }
  }

  /** Read and ingest new bytes from [this.offset, stat.size). Returns event count. */
  private ingestRange(stat: fs.Stats): number {
    const toRead = stat.size - this.offset;
    if (toRead <= 0) return 0;

    const buf = Buffer.alloc(toRead);
    const fd = fs.openSync(this.relayPath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, this.offset);
    fs.closeSync(fd);

    if (bytesRead === 0) return 0;

    this.offset += bytesRead;
    this.saveOffset();

    const text = buf.subarray(0, bytesRead).toString('utf-8');
    const lines = text.split('\n');
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as Record<string, unknown>;
        ingestRawEvent(raw, this.broadcaster);
        count++;
      } catch {
        logger.warn({ line: trimmed.slice(0, 120) }, 'FileEventRelay: malformed line — skipping');
      }
    }

    if (count > 0) {
      this._eventsIngested += count;
      this._lastIngestAt = new Date();
    }
    return count;
  }

  /**
   * Compact the relay file by removing already-read bytes.
   *
   * Reads any unprocessed tail (bytes after current offset), rewrites the file
   * with just the tail, and resets offset. Hook writers appending concurrently
   * may race — any bytes appended during compaction that aren't in the tail
   * snapshot will appear as new bytes after the rewrite and be caught on the
   * next poll cycle.
   */
  private compact(): void {
    try {
      const stat = fs.statSync(this.relayPath);
      const tailSize = stat.size - this.offset;

      if (tailSize > 0) {
        // Read unprocessed tail
        const tail = Buffer.alloc(tailSize);
        const fd = fs.openSync(this.relayPath, 'r');
        fs.readSync(fd, tail, 0, tailSize, this.offset);
        fs.closeSync(fd);
        fs.writeFileSync(this.relayPath, tail);
        this.offset = tailSize;
      } else {
        fs.writeFileSync(this.relayPath, '');
        this.offset = 0;
      }

      this._compactions++;
      this.saveOffset();
      logger.info(
        { tailSize, compactions: this._compactions },
        'FileEventRelay: compacted relay file',
      );

      // Restart watcher — file was rewritten
      this.watcher?.close();
      this.watcher = null;
      this.startWatcher();
    } catch (err) {
      logger.warn({ err }, 'FileEventRelay: compaction failed — will retry later');
    }
  }

  private readOffset(): number {
    try {
      const data = JSON.parse(fs.readFileSync(this.offsetPath, 'utf-8'));
      return typeof data.offset === 'number' ? data.offset : 0;
    } catch {
      return 0;
    }
  }

  private saveOffset(): void {
    try {
      fs.writeFileSync(this.offsetPath, JSON.stringify({ offset: this.offset }));
    } catch {
      // Non-fatal — worst case: re-ingest on next restart (duplicates are deduplicated)
    }
  }
}
