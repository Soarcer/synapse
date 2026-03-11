#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard
/**
 * Stress test: floods the Synapse server with events and monitors memory.
 * Run: npx tsx scripts/stress_test.ts
 * Server must be running: pnpm --filter @synapse-ai/server dev
 */

const SERVER_URL = 'http://localhost:4000/api/events';
const EVENTS_PER_SECOND = 50;
const DURATION_SECONDS = 60;
const SAMPLE_INTERVAL_MS = 5000;

async function sendEvent(sessionId: string, i: number) {
  const event = {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    tool_name: `stress_tool_${i % 10}`,
    tool_input: { query: `stress test event ${i}` },
    model: 'claude-opus-4-6',
    cwd: '/stress/test',
  };
  await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

async function checkMemory(): Promise<{ heapUsed: number; heapTotal: number }> {
  const res = await fetch('http://localhost:4000/api/health');
  const data = (await res.json()) as { memoryUsage?: { heapUsed: number; heapTotal: number } };
  return data.memoryUsage ?? { heapUsed: 0, heapTotal: 0 };
}

async function main() {
  const sessionId = `stress-${Date.now()}`;
  console.log(`Starting stress test: ${EVENTS_PER_SECOND} events/sec for ${DURATION_SECONDS}s`);
  console.log('');

  const samples: { time: number; heapUsed: number }[] = [];
  let eventCount = 0;
  const startTime = Date.now();

  // Sample memory periodically
  const sampler = setInterval(async () => {
    const mem = await checkMemory();
    const elapsed = (Date.now() - startTime) / 1000;
    samples.push({ time: elapsed, heapUsed: mem.heapUsed });
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    console.log(`t=${elapsed.toFixed(0)}s | events=${eventCount} | heap=${heapMB}MB`);
  }, SAMPLE_INTERVAL_MS);

  // Flood with events
  const floodInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    if (elapsed > DURATION_SECONDS * 1000) {
      clearInterval(floodInterval);
      clearInterval(sampler);

      // Analysis
      console.log('\n--- Results ---');
      if (samples.length >= 2) {
        const firstHeap = samples[0].heapUsed;
        const lastHeap = samples[samples.length - 1].heapUsed;
        const growthPct = (((lastHeap - firstHeap) / firstHeap) * 100).toFixed(1);
        const growing = lastHeap > firstHeap * 1.2;
        console.log(`Heap growth: ${growthPct}% (${growing ? 'FAIL — >20% growth' : 'PASS'})`);
        console.log(`Total events sent: ${eventCount}`);
      }
      process.exit(0);
    }

    // Send batch
    const batch = Array.from({ length: Math.floor(EVENTS_PER_SECOND / 10) }, (_, i) =>
      sendEvent(sessionId, eventCount + i),
    );
    await Promise.allSettled(batch);
    eventCount += batch.length;
  }, 100);
}

main().catch(console.error);
