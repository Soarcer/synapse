import { build } from 'esbuild';

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
    'better-sqlite3',
    'express',
    'ws',
  ],
});

console.log('  Plugin built: dist/plugin.js');
