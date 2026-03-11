import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Graph rendering', () => {
  test('Dashboard loads and React Flow canvas is visible', async ({ page }) => {
    await page.goto('/');
    // React Flow renders a .react-flow element
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 10000 });
  });

  test('Empty state shows when no events', async ({ page }) => {
    await page.goto('/');
    const reactFlow = page.locator('.react-flow__nodes');
    // Either empty state visible OR react flow has nodes
    const hasNodes = await reactFlow.locator('.react-flow__node').count();
    if (hasNodes === 0) {
      // Empty state should be shown
      await expect(page.locator('text=/no.*session|no.*agent|waiting/i')).toBeVisible({
        timeout: 5000,
      });
    }
    // Either way, page loaded without error
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('Simulated session events appear as nodes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.react-flow')).toBeVisible();

    // Run the simulation script to inject events
    // Resolve monorepo root relative to this file's location (e2e/ -> dashboard/ -> monorepo root)
    const monoRoot = path.resolve(__dirname, '../../..');
    await execAsync('npx tsx scripts/simulate_session.ts', {
      cwd: monoRoot,
    });

    // Wait for nodes to appear (up to 10 seconds)
    await page.waitForSelector('.react-flow__node', { timeout: 10000 });
    // Should have multiple nodes from the simulation
    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBeGreaterThan(0);
  });
});
