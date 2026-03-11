// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import path from 'path';
import os from 'os';
import { readFullTranscript } from '../services/transcriptReader.js';

const FIXTURE_DIR = path.join(os.tmpdir(), 'synapse-transcript-test-' + Date.now());

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function writeFixture(name: string, lines: unknown[]): string {
  const filePath = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n'));
  return filePath;
}

describe('readFullTranscript', () => {
  it('parses assistant record with thinking block', async () => {
    const fp = writeFixture('thinking.jsonl', [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        timestamp: '2026-02-19T10:00:00.000Z',
        sessionId: 'sess1',
        isSidechain: false,
        isMeta: false,
        message: {
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I need to find the auth files.', signature: 'sig123' },
            { type: 'text', text: 'Let me search for that.' },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
          },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');

    expect(result.conversations).toHaveLength(1);
    const conv = result.conversations[0];
    expect(conv.uuid).toBe('a1');
    expect(conv.parentUuid).toBe('u1');
    expect(conv.type).toBe('assistant');
    expect(conv.isSidechain).toBe(false);
    expect(conv.model).toBe('claude-opus-4-6');

    // Content blocks preserved
    expect(conv.content).toHaveLength(2);
    expect(conv.content[0].type).toBe('thinking');
    if (conv.content[0].type === 'thinking') {
      expect(conv.content[0].thinking).toBe('I need to find the auth files.');
      expect(conv.content[0].signature).toBe('sig123');
    }
    expect(conv.content[1].type).toBe('text');
    if (conv.content[1].type === 'text') {
      expect(conv.content[1].text).toBe('Let me search for that.');
    }

    // Usage
    expect(conv.usage.inputTokens).toBe(100);
    expect(conv.usage.cacheReadTokens).toBe(80);
  });

  it('parses tool_use and tool_result blocks', async () => {
    const fp = writeFixture('tools.jsonl', [
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-02-19T10:00:01.000Z',
        sessionId: 'sess1',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'bash', input: { command: 'ls -la' } }],
          usage: { input_tokens: 50, output_tokens: 10 },
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        timestamp: '2026-02-19T10:00:02.000Z',
        sessionId: 'sess1',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu1',
              content: 'total 42\ndrwxr-xr-x ...',
              is_error: false,
            },
          ],
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');

    expect(result.conversations).toHaveLength(2);
    const toolUse = result.conversations[0].content[0];
    expect(toolUse.type).toBe('tool_use');
    if (toolUse.type === 'tool_use') {
      expect(toolUse.name).toBe('bash');
      expect(toolUse.input).toEqual({ command: 'ls -la' });
    }

    const toolResult = result.conversations[1].content[0];
    expect(toolResult.type).toBe('tool_result');
    if (toolResult.type === 'tool_result') {
      expect(toolResult.content).toContain('total 42');
      expect(toolResult.is_error).toBe(false);
    }
  });

  it('parses system compact_boundary record', async () => {
    const fp = writeFixture('system.jsonl', [
      {
        type: 'system',
        timestamp: '2026-02-19T10:05:00.000Z',
        sessionId: 'sess1',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'auto', preTokens: 167102 },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    expect(result.system).toHaveLength(1);
    expect(result.system[0].type).toBe('compact_boundary');
    if (result.system[0].type === 'compact_boundary') {
      expect(result.system[0].preTokens).toBe(167102);
      expect(result.system[0].trigger).toBe('auto');
    }
  });

  it('parses progress bash_progress record', async () => {
    const fp = writeFixture('progress.jsonl', [
      {
        type: 'progress',
        timestamp: '2026-02-19T10:00:01.500Z',
        sessionId: 'sess1',
        toolUseID: 'tu1',
        data: {
          type: 'bash_progress',
          output: 'running tests...',
          elapsedTimeSeconds: 1.5,
          totalLines: 10,
          totalBytes: 256,
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    expect(result.progress).toHaveLength(1);
    expect(result.progress[0].type).toBe('bash_progress');
    if (result.progress[0].type === 'bash_progress') {
      expect(result.progress[0].output).toBe('running tests...');
      expect(result.progress[0].elapsedTimeSeconds).toBe(1.5);
    }
  });

  it('parses file-history-snapshot record', async () => {
    const fp = writeFixture('filehistory.jsonl', [
      {
        type: 'file-history-snapshot',
        timestamp: '2026-02-19T10:01:00.000Z',
        sessionId: 'sess1',
        snapshot: {
          messageId: 'msg1',
          timestamp: '2026-02-19T10:01:00.000Z',
          trackedFileBackups: {
            'src/auth.ts': {
              backupFileName: 'auth.ts.bak',
              version: 1,
              backupTime: '2026-02-19T10:01:00.000Z',
            },
          },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    expect(result.fileHistory).toHaveLength(1);
    expect(result.fileHistory[0].files).toHaveLength(1);
    expect(result.fileHistory[0].files[0].filePath).toBe('src/auth.ts');
  });

  it('parses queue-operation record', async () => {
    const fp = writeFixture('queue.jsonl', [
      {
        type: 'queue-operation',
        timestamp: '2026-02-19T10:02:00.000Z',
        sessionId: 'sess1',
        operation: 'enqueue',
        content: 'follow-up prompt text',
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    expect(result.queueOps).toHaveLength(1);
    expect(result.queueOps[0].operation).toBe('enqueue');
    expect(result.queueOps[0].content).toBe('follow-up prompt text');
  });

  it('preserves context flags on conversation records', async () => {
    const fp = writeFixture('flags.jsonl', [
      {
        type: 'assistant',
        uuid: 'a3',
        timestamp: '2026-02-19T10:00:00.000Z',
        sessionId: 'sess1',
        isSidechain: true,
        isMeta: false,
        isCompactSummary: false,
        isApiErrorMessage: true,
        permissionMode: 'bypassPermissions',
        cwd: '/home/user/project',
        gitBranch: 'fix/auth-bug',
        error: 'rate_limit',
        slug: 'ancient-swimming-brooks',
        version: '2.1.47',
        message: {
          model: '<synthetic>',
          role: 'assistant',
          content: [{ type: 'text', text: 'Rate limited.' }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    const conv = result.conversations[0];
    expect(conv.isSidechain).toBe(true);
    expect(conv.isApiErrorMessage).toBe(true);
    expect(conv.permissionMode).toBe('bypassPermissions');
    expect(conv.cwd).toBe('/home/user/project');
    expect(conv.gitBranch).toBe('fix/auth-bug');
    expect(conv.error).toBe('rate_limit');
    expect(conv.slug).toBe('ancient-swimming-brooks');
    expect(conv.version).toBe('2.1.47');
  });

  it('preserves extended usage fields', async () => {
    const fp = writeFixture('usage.jsonl', [
      {
        type: 'assistant',
        uuid: 'a4',
        timestamp: '2026-02-19T10:00:00.000Z',
        sessionId: 'sess1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
            cache_creation: {
              ephemeral_5m_input_tokens: 15,
              ephemeral_1h_input_tokens: 5,
            },
            server_tool_use: {
              web_search_requests: 2,
              web_fetch_requests: 1,
            },
          },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    const usage = result.conversations[0].usage;
    expect(usage.ephemeral5mTokens).toBe(15);
    expect(usage.ephemeral1hTokens).toBe(5);
    expect(usage.serverToolUse.webSearchRequests).toBe(2);
    expect(usage.serverToolUse.webFetchRequests).toBe(1);
  });

  it('still produces a valid backward-compatible summary', async () => {
    const fp = writeFixture('compat.jsonl', [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-02-19T10:00:00.000Z',
        sessionId: 'sess1',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Fix the auth bug' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-02-19T10:00:02.000Z',
        sessionId: 'sess1',
        message: {
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me look at the code.' },
            { type: 'text', text: 'I found the issue.' },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
          },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');

    // Summary should be identical to what readTranscript() produces
    expect(result.summary.sessionId).toBe('sess1');
    expect(result.summary.turns).toHaveLength(2);
    expect(result.summary.turns[1].thinkingLength).toBe('Let me look at the code.'.length);
    expect(result.summary.turns[1].textLength).toBe('I found the issue.'.length);
    expect(result.summary.totalInputTokens).toBe(100);
  });

  it('truncates tool result content at 50KB', async () => {
    const largeOutput = 'x'.repeat(60_000);
    const fp = writeFixture('large.jsonl', [
      {
        type: 'user',
        uuid: 'u5',
        timestamp: '2026-02-19T10:00:00.000Z',
        sessionId: 'sess1',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: largeOutput, is_error: false },
          ],
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    const block = result.conversations[0].content[0];
    if (block.type === 'tool_result') {
      expect(block.content.length).toBeLessThanOrEqual(51_200); // 50KB + some margin
    }
  });

  it('should include isMeta flag on TranscriptTurn', async () => {
    const fp = writeFixture('ismeta.jsonl', [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-02-20T10:00:00Z',
        sessionId: 'sess1',
        isMeta: true,
        message: { role: 'user', content: [{ type: 'text', text: '/skill expansion' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-02-20T10:00:01Z',
        sessionId: 'sess1',
        isMeta: false,
        message: {
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [{ type: 'text', text: 'Real response' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
    ]);

    const result = await readFullTranscript(fp, 'sess1');
    expect(result.summary.turns[0].isMeta).toBe(true);
    expect(result.summary.turns[1].isMeta).toBe(false);
  });

  it('skips malformed lines without crashing', async () => {
    const filePath = path.join(FIXTURE_DIR, 'malformed.jsonl');
    fs.writeFileSync(
      filePath,
      [
        'not json at all',
        '{"type": "user", "uuid": "u1", "timestamp": "2026-02-19T10:00:00.000Z", "sessionId": "sess1", "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}}',
        '{malformed json',
      ].join('\n'),
    );

    const result = await readFullTranscript(filePath, 'sess1');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].uuid).toBe('u1');
  });

  it('readFullTranscript returns a promise', async () => {
    const fp = writeFixture('async-check.jsonl', [
      { type: 'summary', sessionId: 'sess1', timestamp: '2026-02-22T00:00:00Z' },
    ]);
    const result = readFullTranscript(fp, 'sess1');
    expect(result).toBeInstanceOf(Promise);
    await result; // should resolve without error
  });
});
