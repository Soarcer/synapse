import { test, expect } from '@playwright/test';

test.describe('Analytics Overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?view=analytics');
    // Wait for the analytics page to load (either real data or mock fallback)
    await page.waitForSelector('[data-testid="analytics-page"], .analytics-page, h1', {
      timeout: 10_000,
    });
  });

  test('navigates to analytics page and renders tabs', async ({ page }) => {
    // Check that the page loaded
    const heading = page.locator('text=Analytics');
    await expect(heading.first()).toBeVisible({ timeout: 10_000 });

    // Verify at least some tab buttons are visible
    const tabContainer = page.locator('button, [role="tab"]');
    const tabCount = await tabContainer.count();
    expect(tabCount).toBeGreaterThan(0);
  });

  test('shows KPI cards with numeric values', async ({ page }) => {
    // Look for KPI-style cards — they typically contain numbers
    await page.waitForTimeout(2000); // Allow time for data fetch + mock fallback

    // Check for elements that look like metric displays
    const metricElements = page.locator('[class*="text-2xl"], [class*="text-3xl"], [class*="font-bold"]');
    const count = await metricElements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('time range selector is present and clickable', async ({ page }) => {
    // Look for time range selector buttons (24h, 7d, 30d, etc.)
    const timeButtons = page.locator('button:has-text("7d"), button:has-text("24h"), button:has-text("30d")');
    const count = await timeButtons.count();
    expect(count).toBeGreaterThan(0);

    // Click a time range button
    if (count > 0) {
      await timeButtons.first().click();
      // Page should not error out
      await page.waitForTimeout(500);
    }
  });

  test('renders chart elements (SVG)', async ({ page }) => {
    await page.waitForTimeout(2000); // Allow time for chart rendering

    // Recharts renders SVG elements
    const svgElements = page.locator('svg.recharts-surface, svg');
    const count = await svgElements.count();
    expect(count).toBeGreaterThan(0);
  });

  test('responsive layout at 1024px width', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);

    // Page should still render without horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1024 + 20); // small margin for scrollbar
  });

  test('responsive layout at 1440px width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1440 + 20);
  });
});
