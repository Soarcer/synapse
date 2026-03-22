// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { validateCwd } from '../services/hookConfigService.js';

describe('validateCwd', () => {
  it('rejects relative paths', () => {
    expect(() => validateCwd('relative/path')).toThrow(/absolute/i);
  });

  it('rejects paths with .. segments', () => {
    expect(() => validateCwd('/foo/bar/../../../etc')).toThrow();
  });

  it('rejects home directory', () => {
    expect(() => validateCwd(os.homedir())).toThrow(/global/i);
  });

  it('rejects ~/.claude directory', () => {
    expect(() => validateCwd(path.join(os.homedir(), '.claude'))).toThrow(/global/i);
  });

  it('rejects paths where .claude/ does not exist', () => {
    const fakePath = path.join(os.tmpdir(), 'nonexistent-project-' + Date.now());
    expect(() => validateCwd(fakePath)).toThrow(/\.claude/);
  });

  it('accepts valid project with .claude/ directory', () => {
    const tmp = path.join(os.tmpdir(), 'hookconfig-test-' + Date.now());
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    try {
      expect(() => validateCwd(tmp)).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
