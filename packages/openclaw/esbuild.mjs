import { build } from 'esbuild';

// 1. Plugin entry point
await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  outfile: 'dist/plugin.js',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: [
    'openclaw',
    'openclaw/plugin-sdk/core',
  ],
});

// 2. Bundled Synapse server (eliminates tsx runtime dependency)
await build({
  entryPoints: ['../server/src/index.ts'],
  bundle: true,
  outfile: 'dist/synapse-server.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['better-sqlite3'],
});

console.log('  Plugin built: dist/plugin.js + dist/synapse-server.mjs');
