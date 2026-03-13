// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SYNAPSE_PORT;
    delete process.env.SYNAPSE_TLS_CERT;
    delete process.env.SYNAPSE_TLS_KEY;
    delete process.env.VITE_DEV_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadConfig() {
    vi.resetModules();
    return import('../config.js');
  }

  describe('SYNAPSE_PORT', () => {
    it('defaults to 27246 when env var is not set', async () => {
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(27246);
    });

    it('reads SYNAPSE_PORT from env var', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(27300);
    });

    it('throws on non-numeric SYNAPSE_PORT', async () => {
      process.env.SYNAPSE_PORT = 'abc';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="abc"');
    });

    it('throws on privileged port (< 1024)', async () => {
      process.env.SYNAPSE_PORT = '80';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="80"');
    });

    it('throws on port too high (> 65533, needs +2 headroom)', async () => {
      process.env.SYNAPSE_PORT = '65534';
      await expect(loadConfig()).rejects.toThrow('Invalid SYNAPSE_PORT="65534"');
    });

    it('accepts port at upper boundary (65533)', async () => {
      process.env.SYNAPSE_PORT = '65533';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(65533);
    });

    it('accepts port at lower boundary (1024)', async () => {
      process.env.SYNAPSE_PORT = '1024';
      const config = await loadConfig();
      expect(config.SYNAPSE_PORT).toBe(1024);
    });
  });

  describe('derived ports', () => {
    it('HOOK_PORT is SYNAPSE_PORT + 1', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.HOOK_PORT).toBe(27301);
    });

    it('HTTP_FALLBACK_PORT is SYNAPSE_PORT + 2', async () => {
      process.env.SYNAPSE_PORT = '27300';
      const config = await loadConfig();
      expect(config.HTTP_FALLBACK_PORT).toBe(27302);
    });
  });

  describe('TLS detection', () => {
    it('USE_TLS is false when neither env var is set', async () => {
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is false when only cert is set', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is false when only key is set', async () => {
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(false);
    });

    it('USE_TLS is true when both cert and key are set', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.USE_TLS).toBe(true);
    });
  });

  describe('protocol strings', () => {
    it('PROTOCOL is "http" without TLS', async () => {
      const config = await loadConfig();
      expect(config.PROTOCOL).toBe('http');
    });

    it('PROTOCOL is "https" with TLS', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.PROTOCOL).toBe('https');
    });

    it('WS_PROTOCOL is "ws" without TLS', async () => {
      const config = await loadConfig();
      expect(config.WS_PROTOCOL).toBe('ws');
    });

    it('WS_PROTOCOL is "wss" with TLS', async () => {
      process.env.SYNAPSE_TLS_CERT = './cert.pem';
      process.env.SYNAPSE_TLS_KEY = './key.pem';
      const config = await loadConfig();
      expect(config.WS_PROTOCOL).toBe('wss');
    });
  });

  describe('DEV_PORT', () => {
    it('defaults to 5173', async () => {
      const config = await loadConfig();
      expect(config.DEV_PORT).toBe(5173);
    });

    it('reads VITE_DEV_PORT from env var', async () => {
      process.env.VITE_DEV_PORT = '3000';
      const config = await loadConfig();
      expect(config.DEV_PORT).toBe(3000);
    });
  });
});
