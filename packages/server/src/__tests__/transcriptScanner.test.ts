import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TranscriptSummary } from '@synapse-ai/core';

// ── Mock db module ────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  getTranscriptIndexEntry: vi.fn(),
  upsertTranscriptIndex: vi.fn(),
  isLiveSession: vi.fn().mockReturnValue(false),
  getAllTranscriptIndex: vi.fn().mockReturnValue({ rows: [], total: 0 }),
}));

// ── Mock transcriptReader ─────────────────────────────────────────
vi.mock('../services/transcriptReader.js', () => ({
  readTranscript: vi.fn(),
}));

// ── Helper: build a minimal TranscriptSummary ─────────────────────
function makeSummary(overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
  return {
    sessionId: 'test',
    transcriptPath: '/tmp/test.jsonl',
    turns: [
      {
        uuid: 'u1',
        timestamp: 1000,
        type: 'user',
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contentTypes: ['text'],
        toolNames: [],
        toolUseCount: 0,
        textLength: 10,
        thinkingLength: 0,
        totalInputTokens: 100,
        cacheHitRate: 0,
      },
      {
        uuid: 'a1',
        timestamp: 2000,
        type: 'assistant',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contentTypes: ['text'],
        toolNames: ['Read'],
        toolUseCount: 1,
        textLength: 50,
        thinkingLength: 0,
        totalInputTokens: 500,
        cacheHitRate: 0,
      },
    ],
    totalInputTokens: 600,
    totalOutputTokens: 200,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    modelUsage: [{ model: 'claude-sonnet-4-20250514', calls: 1, inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 }],
    estimatedCostUsd: 0.005,
    avgCacheHitRate: 0,
    peakCacheHitRate: 0,
    totalDurationMs: 1000,
    avgResponseLatencyMs: 1000,
    totalThinkingChars: 0,
    totalTextChars: 60,
    totalToolCalls: 1,
    uniqueToolNames: ['Read'],
    ...overrides,
  };
}

// ── Temp directory management ─────────────────────────────────────
let tmpDir: string;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('scanTranscriptsInDir', () => {
  it('returns empty result when scan directory does not exist', async () => {
    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');

    const result = await scanTranscriptsInDir('/nonexistent/path/that/does/not/exist');

    expect(result.scanned).toBe(0);
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('indexes valid JSONL files', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    fs.writeFileSync(path.join(tmpDir, 'session-aaa.jsonl'), '{"type":"user"}\n');
    fs.writeFileSync(path.join(tmpDir, 'session-bbb.jsonl'), '{"type":"user"}\n');

    const { readTranscript } = await import('../services/transcriptReader.js');
    const { upsertTranscriptIndex, getTranscriptIndexEntry, isLiveSession } = await import('../db.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getTranscriptIndexEntry as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (readTranscript as ReturnType<typeof vi.fn>).mockImplementation((_fp: string, sid: string) =>
      makeSummary({ sessionId: sid }),
    );

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir, 'test-hash');

    expect(result.scanned).toBe(2);
    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(upsertTranscriptIndex).toHaveBeenCalledTimes(2);
  });

  it('skips live sessions that already have hook events', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    fs.writeFileSync(path.join(tmpDir, 'live-session.jsonl'), '{"type":"user"}\n');

    const { isLiveSession, getTranscriptIndexEntry } = await import('../db.js');
    const { readTranscript } = await import('../services/transcriptReader.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getTranscriptIndexEntry as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (readTranscript as ReturnType<typeof vi.fn>).mockReturnValue(makeSummary());

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir);

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(0);
    expect(readTranscript).not.toHaveBeenCalled();
  });

  it('skips unchanged files with same file size', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    const content = '{"type":"user"}\n';
    fs.writeFileSync(path.join(tmpDir, 'unchanged.jsonl'), content);
    const fileSize = fs.statSync(path.join(tmpDir, 'unchanged.jsonl')).size;

    const { getTranscriptIndexEntry, isLiveSession } = await import('../db.js');
    const { readTranscript } = await import('../services/transcriptReader.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getTranscriptIndexEntry as ReturnType<typeof vi.fn>).mockReturnValue({
      session_id: 'unchanged',
      file_size_bytes: fileSize,
    });
    (readTranscript as ReturnType<typeof vi.fn>).mockReturnValue(makeSummary());

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir);

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(0);
    expect(readTranscript).not.toHaveBeenCalled();
  });

  it('re-indexes files that have grown', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    const content = '{"type":"user"}\n{"type":"assistant","message":{"model":"claude-sonnet-4-20250514","content":[]}}\n';
    fs.writeFileSync(path.join(tmpDir, 'grown.jsonl'), content);
    const actualSize = fs.statSync(path.join(tmpDir, 'grown.jsonl')).size;

    const { getTranscriptIndexEntry, isLiveSession, upsertTranscriptIndex } = await import('../db.js');
    const { readTranscript } = await import('../services/transcriptReader.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getTranscriptIndexEntry as ReturnType<typeof vi.fn>).mockReturnValue({
      session_id: 'grown',
      file_size_bytes: actualSize - 10, // smaller than actual
    });
    (readTranscript as ReturnType<typeof vi.fn>).mockImplementation((_fp: string, sid: string) =>
      makeSummary({ sessionId: sid }),
    );

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir);

    expect(result.scanned).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(readTranscript).toHaveBeenCalledTimes(1);
    expect(upsertTranscriptIndex).toHaveBeenCalledTimes(1);
  });

  it('skips files larger than 200 MB', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    fs.writeFileSync(path.join(tmpDir, 'huge-file.jsonl'), 'x');

    const { isLiveSession } = await import('../db.js');
    const { readTranscript } = await import('../services/transcriptReader.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Mock fs.statSync to report a huge file size
    const originalStatSync = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike, ...args: unknown[]) => {
      const filePath = p.toString();
      if (filePath.includes('huge-file.jsonl')) {
        return { size: 300 * 1024 * 1024 } as fs.Stats; // 300 MB
      }
      return originalStatSync(p, ...(args as [fs.StatSyncOptions?]));
    });

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir);

    expect(result.scanned).toBe(1);
    expect(result.indexed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('file_too_large');
    expect(result.errors[0].sessionId).toBe('huge-file');
    expect(readTranscript).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('captures parse errors without aborting scan', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-scanner-test-'));
    fs.writeFileSync(path.join(tmpDir, 'good-file.jsonl'), '{"type":"user"}\n');
    fs.writeFileSync(path.join(tmpDir, 'bad-file.jsonl'), '{"type":"user"}\n');

    const { readTranscript } = await import('../services/transcriptReader.js');
    const { isLiveSession, getTranscriptIndexEntry, upsertTranscriptIndex } = await import('../db.js');

    (isLiveSession as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getTranscriptIndexEntry as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    (readTranscript as ReturnType<typeof vi.fn>).mockImplementation((_fp: string, sid: string) => {
      if (sid === 'bad-file') {
        throw new Error('Corrupt JSONL data');
      }
      return makeSummary({ sessionId: sid });
    });

    const { scanTranscriptsInDir } = await import('../services/transcriptScanner.js');
    const result = await scanTranscriptsInDir(tmpDir);

    expect(result.scanned).toBe(2);
    expect(result.indexed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionId).toBe('bad-file');
    expect(result.errors[0].reason).toBe('parse_error');
    expect(upsertTranscriptIndex).toHaveBeenCalledTimes(1);
  });
});
