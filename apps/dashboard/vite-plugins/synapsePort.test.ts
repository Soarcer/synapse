import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { readServerPort, synapsePortWatcher } from './synapsePort';

describe('readServerPort', () => {
  let readFileSyncSpy: ReturnType<typeof vi.spyOn<typeof fs, 'readFileSync'>>;

  beforeEach(() => {
    delete process.env.SYNAPSE_PORT;
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns port from project port file when valid', () => {
    readFileSyncSpy
      .mockReturnValueOnce('4027' as unknown as Buffer) // project file
      .mockReturnValueOnce('9999' as unknown as Buffer); // global file (should not be reached)
    expect(readServerPort()).toBe('4027');
  });

  it('falls back to global port file when project file is missing', () => {
    readFileSyncSpy
      .mockImplementationOnce(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      })
      .mockReturnValueOnce('4028' as unknown as Buffer);
    expect(readServerPort()).toBe('4028');
  });

  it('falls back to SYNAPSE_PORT env var when both files are missing', () => {
    readFileSyncSpy.mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    process.env.SYNAPSE_PORT = '4100';
    expect(readServerPort()).toBe('4100');
  });

  it('falls back to 4000 when nothing is configured', () => {
    readFileSyncSpy.mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects non-numeric file content', () => {
    readFileSyncSpy
      .mockReturnValueOnce('not-a-port' as unknown as Buffer)
      .mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects privileged ports (<= 1023)', () => {
    readFileSyncSpy.mockReturnValueOnce('80' as unknown as Buffer).mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    expect(readServerPort()).toBe('4000');
  });

  it('rejects ports above 65535', () => {
    readFileSyncSpy.mockReturnValueOnce('99999' as unknown as Buffer).mockImplementation(() => {
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    expect(readServerPort()).toBe('4000');
  });
});

describe('synapsePortWatcher plugin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a Vite plugin with the correct name', () => {
    const plugin = synapsePortWatcher();
    expect(plugin.name).toBe('synapse-port-watcher');
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('sets up a directory watcher in configureServer', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('4027' as unknown as Buffer);
    vi.spyOn(fs, 'watch').mockReturnValue({ close: vi.fn() } as unknown as fs.FSWatcher);

    const mockHttpServer = { once: vi.fn() };
    const mockServer = {
      ws: { send: vi.fn() },
      httpServer: mockHttpServer,
      restart: vi.fn(),
    };

    const plugin = synapsePortWatcher();
    (plugin.configureServer as (s: typeof mockServer) => void)(mockServer);

    expect(fs.watch).toHaveBeenCalled();
  });

  it('falls back to watchFile when directory watch throws', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('4027' as unknown as Buffer);
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    vi.spyOn(fs, 'watchFile').mockImplementation(() => fs);

    const mockServer = {
      ws: { send: vi.fn() },
      httpServer: { once: vi.fn() },
      restart: vi.fn(),
    };

    const plugin = synapsePortWatcher();
    expect(() =>
      (plugin.configureServer as (s: typeof mockServer) => void)(mockServer),
    ).not.toThrow();

    expect(fs.watchFile).toHaveBeenCalled();
  });
});
