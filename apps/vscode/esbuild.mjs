import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');
const skipServer = process.argv.includes('--skip-server');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RESOURCES = path.resolve(import.meta.dirname, 'resources');
const SERVER_OUT = path.join(RESOURCES, 'synapse-server');
const DASHBOARD_DIST = path.join(SERVER_OUT, 'dashboard');

// ── 1. Bundle the VS Code extension ──────────────────────────────────

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  try {
    await ctx.rebuild();
    console.log('[1/4] Extension bundle complete.');
  } catch (err) {
    console.error('Extension build failed:', err);
    process.exit(1);
  } finally {
    await ctx.dispose();
  }

  if (!skipServer) {
    // ── 2. Bundle the Synapse server (pure JS — no native modules) ────

    fs.mkdirSync(SERVER_OUT, { recursive: true });

    const serverCtx = await esbuild.context({
      entryPoints: [path.join(ROOT, 'packages', 'server', 'src', 'index.ts')],
      bundle: true,
      outfile: path.join(SERVER_OUT, 'server.mjs'),
      format: 'esm',
      platform: 'node',
      target: 'node20',
      sourcemap: false,
      minify: true,
      // Use sql.js asm.js variant (pure JS, no WASM file needed at runtime)
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

    // ── 3. Copy hook script ──────────────────────────────────────────────

    const hooksSrc = path.join(ROOT, 'hooks', 'send_event.cjs');
    const hooksDst = path.join(SERVER_OUT, 'hooks', 'send_event.cjs');
    if (fs.existsSync(hooksSrc)) {
      fs.mkdirSync(path.dirname(hooksDst), { recursive: true });
      fs.copyFileSync(hooksSrc, hooksDst);
      console.log('[3/4] Hook script copied.');
    } else {
      console.warn('[3/4] WARNING: hooks/send_event.cjs not found at', hooksSrc);
    }

    // ── 4. Build dashboard frontend ────────────────────────────────────

    try {
      console.log('[4/4] Building dashboard frontend...');
      execSync('pnpm --filter @synapse-ai/dashboard build', {
        cwd: ROOT,
        stdio: 'inherit',
      });

      // Copy dist to resources
      const dashboardDist = path.join(ROOT, 'apps', 'dashboard', 'dist');
      if (fs.existsSync(dashboardDist)) {
        if (fs.existsSync(DASHBOARD_DIST)) {
          fs.rmSync(DASHBOARD_DIST, { recursive: true });
        }
        copyDirSync(dashboardDist, DASHBOARD_DIST);
        console.log('[4/4] Dashboard frontend built and copied.');
      } else {
        console.warn('[4/4] WARNING: Dashboard dist not found after build');
      }
    } catch (err) {
      console.error('[4/4] Dashboard build failed:', err.message);
      console.warn('Extension will work but cannot serve the dashboard UI.');
    }
  }
}

// ── Helper: recursive directory copy ───────────────────────────────────

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
