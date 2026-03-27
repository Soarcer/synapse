/**
 * Synapse Screenshot Pipeline
 *
 * Prerequisites: server (start-server.ps1) + frontend (start-client.ps1) running.
 *
 * Usage:
 *   npx playwright install chromium     # one-time
 *   npx tsx scripts/capture_screenshots.ts
 *   npx tsx scripts/capture_screenshots.ts --suffix=v2
 */

import { chromium, type Page, type Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { clearAllEvents, seedSimulation } from './screenshot_simulation.js';
import { generateGallery } from './screenshot_gallery.js';

const BASE_URL = 'http://localhost:5173';
const OUT_DIR = path.join(process.cwd(), 'assets', 'screenshots');
const suffix = process.argv.find((a) => a.startsWith('--suffix='))?.split('=')[1] ?? '';

// ── Helpers ──────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function shotPath(category: string, name: string, ext: 'png' | 'webp'): string {
  const fname = suffix ? `${name}-${suffix}.${ext}` : `${name}.${ext}`;
  return path.join(OUT_DIR, category, fname);
}

async function capturePng(page: Page, category: string, name: string): Promise<void> {
  ensureDir(path.join(OUT_DIR, category));
  const pngPath = shotPath(category, name, 'png');
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`  📸 ${category}/${name}.png`);
}

async function waitForGraphReady(page: Page, minNodes: number): Promise<void> {
  console.log(`  Waiting for ${minNodes}+ nodes to render...`);
  await page.waitForFunction(
    (min) => document.querySelectorAll('.react-flow__node').length >= min,
    minNodes,
    { timeout: 30000 },
  );
  // Extra settle time for layout animations
  await page.waitForTimeout(1500);
  console.log('  ✓ Graph ready');
}

// Type IDDQD sequence to unlock arcade mode
async function typeIddqd(page: Page): Promise<void> {
  for (const key of ['i', 'd', 'd', 'q', 'd']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500); // wait for unlock animation
}

// ── Shot Definitions ─────────────────────────────────────────

interface ShotDef {
  id: string;
  category: string;
  name: string;
  viewport: { width: number; height: number };
  url?: string;
  setup: (page: Page) => Promise<void>;
  waitMs: number;
}

const SHOTS: ShotDef[] = [
  // ── Hero ──
  {
    id: 'H1',
    category: 'hero',
    name: 'graph-overview',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Click an agent node (A2 — DB Refactor) for selection highlight
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 2) await agentNodes.nth(1).click();
    },
    waitMs: 1000,
  },
  {
    id: 'H2',
    category: 'hero',
    name: 'graph-inspector',
    viewport: { width: 1440, height: 800 },
    setup: async (page) => {
      // Click an agent node to open inspector panel
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 2) await agentNodes.nth(1).click();
      await page.waitForTimeout(500);
    },
    waitMs: 1000,
  },
  {
    id: 'H3',
    category: 'hero',
    name: 'sankey-flow',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close inspector by pressing Escape, show lens panel, switch to Sankey
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('l'); // toggle lens
      await page.waitForTimeout(500);
      await page.keyboard.press('4'); // Sankey tab
    },
    waitMs: 1000,
  },
  {
    id: 'H4',
    category: 'hero',
    name: 'social-preview',
    viewport: { width: 1280, height: 640 },
    setup: async (page) => {
      // Close lens, show graph only
      await page.keyboard.press('l'); // hide lens
      await page.waitForTimeout(300);
      // Click an agent for visual interest
      const agentNodes = page.locator('.react-flow__node-agent');
      const count = await agentNodes.count();
      if (count >= 1) await agentNodes.nth(0).click();
    },
    waitMs: 1000,
  },

  // ── Lenses ──
  {
    id: 'L1',
    category: 'lenses',
    name: 'treemap',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press('l'); // show lens
      await page.waitForTimeout(500);
      await page.keyboard.press('1'); // Treemap
    },
    waitMs: 1000,
  },
  {
    id: 'L2',
    category: 'lenses',
    name: 'compaction',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('2'); // Compaction
    },
    waitMs: 1000,
  },
  {
    id: 'L3',
    category: 'lenses',
    name: 'sankey-detail',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('4'); // Sankey
      await page.waitForTimeout(800);
      // Hover a Sankey node for tooltip
      const sankeyNode = page.locator('.sankey-node, [data-type="sankey"] rect').first();
      if (await sankeyNode.isVisible()) {
        await sankeyNode.hover();
      }
    },
    waitMs: 1000,
  },
  {
    id: 'L4',
    category: 'lenses',
    name: 'tree-view',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.keyboard.press('5'); // Tree
      await page.waitForTimeout(500);
      // Click expand arrows to open 2 levels
      const expandBtns = page.locator(
        '[data-tree-expand], .tree-expand-btn, button[aria-label*="expand"]',
      );
      const count = await expandBtns.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        await expandBtns.nth(i).click();
        await page.waitForTimeout(200);
      }
    },
    waitMs: 1000,
  },

  // ── Features: Tool Group Views ──
  {
    id: 'F1',
    category: 'features',
    name: 'toolgroup-pillgrid',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close lens, return to graph
      await page.keyboard.press('l'); // hide lens
      await page.waitForTimeout(300);
      // Open View Settings → Tool View → Pill Grid
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const pillGridBtn = page.locator('button').filter({ hasText: 'Pill Grid' });
      if (await pillGridBtn.isVisible()) await pillGridBtn.click();
      await page.waitForTimeout(500);
      // Click a tool group node
      const tgNode = page.locator('[class*="react-flow__node-toolGroup"]').first();
      if (await tgNode.isVisible()) await tgNode.click();
    },
    waitMs: 1000,
  },
  {
    id: 'F2',
    category: 'features',
    name: 'toolgroup-timeline',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const timelineBtn = page.locator('button').filter({ hasText: 'Timeline' });
      if (await timelineBtn.isVisible()) await timelineBtn.click();
    },
    waitMs: 1000,
  },
  {
    id: 'F3',
    category: 'features',
    name: 'toolgroup-heatmap',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const heatmapBtn = page.locator('button').filter({ hasText: 'Heatmap' });
      if (await heatmapBtn.isVisible()) await heatmapBtn.click();
    },
    waitMs: 1000,
  },

  // ── Features: Arcade Modes ──
  {
    id: 'F4',
    category: 'features',
    name: 'arcade-gameoflife',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Unlock arcade via IDDQD
      await typeIddqd(page);
      await page.waitForTimeout(500);
      // Select Game of Life via View Settings
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const gofBtn = page.locator('button').filter({ hasText: 'Game of Life' });
      if (await gofBtn.isVisible()) await gofBtn.click();
    },
    waitMs: 5000, // Wait for pattern evolution
  },
  {
    id: 'F5',
    category: 'features',
    name: 'arcade-tetris',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Tetris' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 8000, // Wait for blocks to accumulate
  },
  {
    id: 'F6',
    category: 'features',
    name: 'arcade-snake',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Snake' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 6000,
  },
  {
    id: 'F7',
    category: 'features',
    name: 'arcade-breakout',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const btn = page.locator('button').filter({ hasText: 'Breakout' });
      if (await btn.isVisible()) await btn.click();
    },
    waitMs: 6000,
  },

  // ── Features: Menus ──
  {
    id: 'F8',
    category: 'features',
    name: 'view-settings',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Deactivate arcade mode first — switch back to Heatmap
      await page.click('button[aria-label="View settings"]');
      await page.waitForTimeout(300);
      const heatmapBtn = page.locator('button').filter({ hasText: 'Heatmap' });
      if (await heatmapBtn.isVisible()) await heatmapBtn.click();
      await page.waitForTimeout(300);
      // Now reopen the dropdown for the screenshot
      await page.click('button[aria-label="View settings"]');
    },
    waitMs: 500,
  },
  {
    id: 'F9',
    category: 'features',
    name: 'keyboard-shortcuts',
    viewport: { width: 1280, height: 800 },
    setup: async (page) => {
      // Close settings dropdown first
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      // Hover the ? icon to show shortcuts tooltip
      const helpIcon = page.locator('[aria-label="Keyboard shortcuts"]');
      if (await helpIcon.isVisible()) {
        await helpIcon.hover();
      }
    },
    waitMs: 500,
  },

  // ── Mobile ──
  {
    id: 'M1',
    category: 'mobile',
    name: 'mobile-graph',
    viewport: { width: 390, height: 844 },
    url: `${BASE_URL}?view=mobile`,
    setup: async (_page) => {
      // Graph tab is default
    },
    waitMs: 1500,
  },
  {
    id: 'M2',
    category: 'mobile',
    name: 'mobile-lens',
    viewport: { width: 390, height: 844 },
    setup: async (page) => {
      // Tap Lenses tab
      const lensTab = page.locator('button').filter({ hasText: 'Lenses' });
      if (await lensTab.isVisible()) await lensTab.click();
    },
    waitMs: 1000,
  },
];

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Clear existing events
  await clearAllEvents();

  // 2. Seed simulation
  const { expectedNodeCount } = await seedSimulation();

  // 3. Launch browser
  console.log('\n\x1b[36m── Launching Playwright ──\x1b[0m');
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // Navigate and wait for graph
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForGraphReady(page, expectedNodeCount);

  // 4. Capture all shots
  console.log('\n\x1b[36m── Capturing Screenshots ──\x1b[0m');
  let capturedCount = 0;

  for (const shot of SHOTS) {
    console.log(`\n  [${shot.id}] ${shot.name}`);

    // Resize viewport if needed
    const currentViewport = page.viewportSize();
    if (
      !currentViewport ||
      currentViewport.width !== shot.viewport.width ||
      currentViewport.height !== shot.viewport.height
    ) {
      await page.setViewportSize(shot.viewport);
      await page.waitForTimeout(500);
    }

    // Navigate to different URL if specified (e.g., mobile view)
    if (shot.url) {
      await page.goto(shot.url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
    }

    // Run shot-specific setup
    await shot.setup(page);

    // Wait for the shot-specific settle time
    await page.waitForTimeout(shot.waitMs);

    // Capture
    await capturePng(page, shot.category, shot.name);
    capturedCount++;
  }

  // 5. Cleanup
  await browser.close();

  // 6. Generate gallery
  console.log('\n\x1b[36m── Generating Gallery ──\x1b[0m');
  generateGallery();

  // 7. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\x1b[1m=== Screenshot Pipeline Complete ===\x1b[0m`);
  console.log(`  Screenshots: ${capturedCount}/${SHOTS.length}`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log(`  Gallery: ${path.join(OUT_DIR, 'index.html')}`);
  console.log(`  Time: ${elapsed}s`);
  console.log(`\n  Open the gallery in a browser to review.\n`);
}

main().catch((err) => {
  console.error('\x1b[31mScreenshot pipeline failed:\x1b[0m', err.message);
  process.exit(1);
});
