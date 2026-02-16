import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:4000/api/analytics';

test.describe('Analytics API Integration', () => {
  test('GET /api/analytics/overview returns valid envelope', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/overview?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
    expect(typeof body.meta.from).toBe('number');
    expect(typeof body.meta.to).toBe('number');
    expect(typeof body.data.totalSessions).toBe('number');
    expect(typeof body.data.totalCost).toBe('number');
    expect(typeof body.data.totalEvents).toBe('number');
  });

  test('GET /api/analytics/timeseries returns array', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/timeseries?from=0&to=${now}&granularity=day`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/sessions returns paginated results', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/sessions?from=0&to=${now}&limit=10`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.totalCount).toBe('number');
  });

  test('GET /api/analytics/tools returns tool summaries', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/tools?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/models returns model breakdowns', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/models?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/turns returns turn data', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/turns?from=0&to=${now}&limit=10`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/tool-calls returns tool call list', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/tool-calls?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/prices returns price list', async ({ request }) => {
    const res = await request.get(`${API_BASE}/prices`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/velocity returns velocity data', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/velocity?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  test('GET /api/analytics/insights returns insights array', async ({ request }) => {
    const now = Date.now();
    const res = await request.get(`${API_BASE}/insights?from=0&to=${now}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/analytics/budget returns budget status', async ({ request }) => {
    const res = await request.get(`${API_BASE}/budget`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  test('GET /api/analytics/badges returns badge definitions', async ({ request }) => {
    const res = await request.get(`${API_BASE}/badges`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  test('CWD filtering returns subset of data', async ({ request }) => {
    const now = Date.now();

    // First seed an event with a specific cwd
    await request.post('http://localhost:4000/api/events', {
      data: {
        hook_event_name: 'SessionStart',
        session_id: `e2e-cwd-test-${Date.now()}`,
        model: 'claude-opus-4-6',
        cwd: '/e2e/test/project',
      },
    });

    const res = await request.get(`${API_BASE}/overview?from=0&to=${now + 5000}&cwd=/e2e/test/project`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Should find at least the event we just created
    expect(body.data.totalEvents).toBeGreaterThanOrEqual(1);
  });

  test('all analytics endpoints respond within 500ms', async ({ request }) => {
    const now = Date.now();
    const endpoints = [
      `${API_BASE}/overview?from=0&to=${now}`,
      `${API_BASE}/timeseries?from=0&to=${now}&granularity=day`,
      `${API_BASE}/sessions?from=0&to=${now}&limit=10`,
      `${API_BASE}/tools?from=0&to=${now}`,
      `${API_BASE}/models?from=0&to=${now}`,
      `${API_BASE}/turns?from=0&to=${now}&limit=10`,
      `${API_BASE}/tool-calls?from=0&to=${now}`,
      `${API_BASE}/prices`,
      `${API_BASE}/budget`,
      `${API_BASE}/badges`,
    ];

    for (const endpoint of endpoints) {
      const start = performance.now();
      const res = await request.get(endpoint);
      const elapsed = performance.now() - start;

      expect(res.status()).toBe(200);
      expect(elapsed).toBeLessThan(500);
    }
  });
});
