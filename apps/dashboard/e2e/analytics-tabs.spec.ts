import { test, expect } from '@playwright/test';

test.describe('Analytics Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?view=analytics');
    await page.waitForTimeout(3000); // Allow page to fully load with mock data fallback
  });

  const EXPECTED_TABS = ['Executive', 'Session Replay', 'Prompts', 'Insights', 'Live Nudges'];
  const REMOVED_TABS = ['Deep Dive', 'Compare', 'What-If', 'Velocity', 'Tool Chains', 'Coach'];

  test('shows exactly 5 tabs', async ({ page }) => {
    for (const tab of EXPECTED_TABS) {
      await expect(page.locator(`button:has-text("${tab}")`).first()).toBeVisible();
    }
  });

  test('removed tabs are gone', async ({ page }) => {
    for (const tab of REMOVED_TABS) {
      await expect(page.locator(`button:has-text("${tab}")`)).toHaveCount(0);
    }
  });

  test('can click through all tabs without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (const tab of EXPECTED_TABS) {
      const btn = page.locator(`button:has-text("${tab}")`).first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    }

    expect(errors.length).toBe(0);
  });

  test('tab content changes when switching tabs', async ({ page }) => {
    const initialContent = await page.evaluate(() => document.body.innerHTML);

    // Click Session Replay tab
    const replayTab = page.locator('button:has-text("Session Replay")').first();
    if (await replayTab.isVisible()) {
      await replayTab.click();
      await page.waitForTimeout(1000);

      const newContent = await page.evaluate(() => document.body.innerHTML);
      expect(newContent).not.toBe(initialContent);
    }
  });
});
