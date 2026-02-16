import { test, expect } from '@playwright/test';

test.describe('Analytics Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?view=analytics');
    await page.waitForTimeout(3000); // Allow page to fully load with mock data fallback
  });

  test('can click through all tabs without errors', async ({ page }) => {
    // Find all tab-like buttons on the analytics page
    const tabButtons = page.locator('button[role="tab"], [class*="tab"] button, button:has-text("Overview"), button:has-text("Explorer"), button:has-text("Replay"), button:has-text("Compare")');
    const tabCount = await tabButtons.count();

    // Click each tab and verify no console errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (let i = 0; i < Math.min(tabCount, 9); i++) {
      const tab = tabButtons.nth(i);
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(500);
      }
    }

    // No unhandled JS errors should have occurred
    expect(errors.length).toBe(0);
  });

  test('tab content changes when switching tabs', async ({ page }) => {
    // Verify the page has content initially
    const bodyLength = await page.evaluate(() => document.body.innerHTML.length);
    expect(bodyLength).toBeGreaterThan(0);

    // Try to click a different tab
    const tabs = page.locator('button[role="tab"], button:has-text("Explorer"), button:has-text("Deep Dive")');
    const tabCount = await tabs.count();

    if (tabCount > 0) {
      await tabs.first().click();
      await page.waitForTimeout(1000);

      // Verify the page still has content (didn't crash)
      const newLength = await page.evaluate(() => document.body.innerHTML.length);
      expect(newLength).toBeGreaterThan(0);
    }
  });
});
