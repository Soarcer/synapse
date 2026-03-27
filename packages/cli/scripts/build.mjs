// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Build script for @synapse-ai/cli — bundles CLI + server + dashboard + hooks
// into packages/cli/dist/ for npm publishing.
//
// Pipeline:
//   1. Compile CLI TypeScript → dist/cli.mjs
//   2. Bundle Synapse server → dist/server.mjs
//   3. Copy hook scripts → dist/hooks/
//   4. Build dashboard → dist/dashboard/

import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_DIR = path.resolve(import.meta.dirname, '..');
const DIST = path.join(CLI_DIR, 'dist');

// ── 1. Compile CLI entry + modules ──────────────────────────────

fs.mkdirSync(DIST, { recursive: true });

const cliCtx = await esbuild.context({
  entryPoints: [path.join(CLI_DIR, 'src', 'cli.ts')],
  bundle: true,
  outfile: path.join(DIST, 'cli.mjs'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: true,
  banner: {
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __pathDirname } from "path";',
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

try {
  await cliCtx.rebuild();
  console.log('[1/4] CLI bundle complete.');
} catch (err) {
  console.error('CLI build failed:', err);
  process.exit(1);
} finally {
  await cliCtx.dispose();
}

// ── 2. Bundle the Synapse server (pure JS — same as VS Code build) ──

const serverCtx = await esbuild.context({
  entryPoints: [path.join(ROOT, 'packages', 'server', 'src', 'index.ts')],
  bundle: true,
  outfile: path.join(DIST, 'server.mjs'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: true,
  plugins: [{
    name: 'sql-js-asm',
    setup(build) {
      build.onResolve({ filter: /^sql\.js$/ }, () => ({
        path: path.join(ROOT, 'packages', 'server', 'node_modules', 'sql.js', 'dist', 'sql-asm.js'),
      }));
    },
  }],
  banner: {
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __pathDirname } from "path";',
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

try {
  await serverCtx.rebuild();
  console.log('[2/4] Server bundle complete.');
} catch (err) {
  console.error('Server build failed:', err);
  process.exit(1);
} finally {
  await serverCtx.dispose();
}

// ── 3. Copy hook scripts ─────────────────────────────────────────

const hooksDir = path.join(DIST, 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });
for (const hookFile of ['send_event.cjs', 'send_gemini_event.cjs', 'send_codex_event.cjs']) {
  const hookSrc = path.join(ROOT, 'hooks', hookFile);
  const hookDst = path.join(hooksDir, hookFile);
  if (fs.existsSync(hookSrc)) {
    fs.copyFileSync(hookSrc, hookDst);
  }
}
console.log('[3/4] Hook scripts copied.');

// ── 4. Build dashboard frontend ──────────────────────────────────

try {
  console.log('[4/4] Building dashboard frontend...');
  execSync('pnpm --filter @synapse-ai/dashboard build', {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const dashboardDist = path.join(ROOT, 'apps', 'dashboard', 'dist');
  const dashboardOut = path.join(DIST, 'dashboard');
  if (fs.existsSync(dashboardDist)) {
    if (fs.existsSync(dashboardOut)) {
      fs.rmSync(dashboardOut, { recursive: true });
    }
    copyDirSync(dashboardDist, dashboardOut);
    console.log('[4/4] Dashboard frontend built and copied.');
  } else {
    console.warn('[4/4] WARNING: Dashboard dist not found after build');
  }
} catch (err) {
  console.error('[4/4] Dashboard build failed:', err.message);
  console.warn('CLI will work but cannot serve the dashboard UI.');
}

// ── Helper: recursive directory copy ──────────────────────────────

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
