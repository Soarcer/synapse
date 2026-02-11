/**
 * Simulates a multi-vendor OpenClaw session by writing JSONL transcript files
 * and/or POSTing pre-normalized events to the Synapse server.
 *
 * Run with: npx tsx openclaw-plugin/scripts/simulate_openclaw.ts
 *
 * Modes:
 *   --jsonl   Write JSONL files to a temp directory (tests Layer 1: JsonlBridge)
 *   --post    POST pre-normalized events to Synapse server (tests event pipeline)
 *   (default) Both modes
 *
 * Simulated scenario:
 *   1. Anthropic/Claude session — code review with Read + Edit tools
 *   2. OpenAI/GPT-4o session — data analysis with Bash + Read tools
 *   3. Google/Gemini session — research with WebSearch + WebFetch tools
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { nanoid } from 'nanoid';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/events';
const args = process.argv.slice(2);
const doJsonl = args.length === 0 || args.includes('--jsonl');
const doPost = args.length === 0 || args.includes('--post');

// ─── Helpers ────────────────────────────────────────────────────────

let stepNum = 0;

async function postEvent(event: Record<string, unknown>, label: string): Promise<void> {
  stepNum++;
  if (!doPost) {
    console.log(`  ${stepNum.toString().padStart(2)}. [SKIP] ${label}`);
    return;
  }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const body = await res.json() as Record<string, unknown>;
    const status = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
    console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label} → ${body.eventId ?? 'n/a'}`);
  } catch (err: any) {
    console.log(`  ${stepNum.toString().padStart(2)}. [\x1b[31mERR\x1b[0m] ${label} → ${err.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function appendJsonl(filepath: string, line: Record<string, unknown>): void {
  if (!doJsonl) return;
  appendFileSync(filepath, JSON.stringify(line) + '\n');
}

// ─── Session Definitions ────────────────────────────────────────────

interface SessionDef {
  agentId: string;
  model: string;
  vendor: string;
  label: string;
  turns: TurnDef[];
}

interface TurnDef {
  userPrompt: string;
  tools: ToolDef[];
  assistantText: string;
  inputTokens: number;
  outputTokens: number;
}

interface ToolDef {
  name: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

const ts = Date.now().toString(36);

const sessions: SessionDef[] = [
  {
    agentId: `claude-reviewer-${ts}`,
    model: 'anthropic/claude-opus-4-6',
    vendor: 'anthropic',
    label: 'Anthropic/Claude (code review)',
    turns: [
      {
        userPrompt: 'Review the authentication module for security issues',
        tools: [
          {
            name: 'Read',
            input: { file_path: 'src/auth/middleware.ts' },
            output: 'export function authMiddleware(req, res, next) { const token = req.headers.authorization?.split(" ")[1]; ... }',
            durationMs: 200,
          },
          {
            name: 'Read',
            input: { file_path: 'src/auth/jwt.ts' },
            output: 'import jwt from "jsonwebtoken"; export function verifyToken(token: string) { return jwt.verify(token, process.env.JWT_SECRET!); }',
            durationMs: 150,
          },
          {
            name: 'Grep',
            input: { pattern: 'password|secret|key', path: 'src/' },
            output: 'src/auth/jwt.ts:3: process.env.JWT_SECRET\nsrc/config.ts:12: apiKey: process.env.API_KEY',
            durationMs: 400,
          },
        ],
        assistantText: 'I found several security concerns in the authentication module:\n1. JWT secret is loaded from env without validation\n2. No token expiry check in verifyToken\n3. Missing rate limiting on auth endpoints',
        inputTokens: 12500,
        outputTokens: 3200,
      },
      {
        userPrompt: 'Fix the JWT expiry issue',
        tools: [
          {
            name: 'Edit',
            input: { file_path: 'src/auth/jwt.ts', old_string: 'jwt.verify(token, process.env.JWT_SECRET!)', new_string: 'jwt.verify(token, process.env.JWT_SECRET!, { maxAge: "24h" })' },
            output: 'File edited successfully',
            durationMs: 300,
          },
        ],
        assistantText: 'I\'ve added a 24-hour max age check to the JWT verification. Tokens older than 24 hours will now be rejected automatically.',
        inputTokens: 8400,
        outputTokens: 1800,
      },
    ],
  },
  {
    agentId: `gpt4o-analyst-${ts}`,
    model: 'openai/gpt-4o',
    vendor: 'openai',
    label: 'OpenAI/GPT-4o (data analysis)',
    turns: [
      {
        userPrompt: 'Analyze the sales data from Q4 and generate a summary report',
        tools: [
          {
            name: 'Bash',
            input: { command: 'wc -l data/sales_q4.csv' },
            output: '15247 data/sales_q4.csv',
            durationMs: 100,
          },
          {
            name: 'Read',
            input: { file_path: 'data/sales_q4.csv', limit: 5 },
            output: 'date,product,region,amount,units\n2025-10-01,Widget A,North,1250.00,50\n2025-10-01,Widget B,South,890.50,35',
            durationMs: 180,
          },
          {
            name: 'Bash',
            input: { command: 'python3 scripts/analyze_sales.py --quarter Q4 --format json' },
            output: '{"total_revenue": 2847500, "top_product": "Widget A", "top_region": "North", "growth_pct": 12.3}',
            durationMs: 2500,
          },
        ],
        assistantText: 'Q4 Sales Summary:\n- Total Revenue: $2,847,500 (+12.3% YoY)\n- Top Product: Widget A ($892K)\n- Top Region: North ($1.2M)\n- 15,247 transactions processed',
        inputTokens: 45000,
        outputTokens: 8500,
      },
    ],
  },
  {
    agentId: `gemini-researcher-${ts}`,
    model: 'google/gemini-2.0-pro',
    vendor: 'google',
    label: 'Google/Gemini (research)',
    turns: [
      {
        userPrompt: 'Research the latest developments in WebAssembly for server-side applications',
        tools: [
          {
            name: 'WebSearch',
            input: { query: 'WebAssembly server side 2026 developments' },
            output: 'Found 15 results: [1] "WASI Preview 3 Released" [2] "Component Model reaches 1.0" [3] "Spin 4.0 supports hot reload"',
            durationMs: 1200,
          },
          {
            name: 'WebFetch',
            input: { url: 'https://wasi.dev/blog/preview-3', prompt: 'Summarize key features' },
            output: 'WASI Preview 3 adds: async I/O, networking sockets, shared-nothing linking, and improved filesystem access.',
            durationMs: 800,
          },
          {
            name: 'WebSearch',
            input: { query: 'WebAssembly component model production usage 2026' },
            output: 'Found 12 results: [1] "Fastly deploys WASM components at edge" [2] "Cloudflare Workers WASM adoption report"',
            durationMs: 1100,
          },
        ],
        assistantText: 'Key developments in server-side WebAssembly (2026):\n1. WASI Preview 3 brings async I/O and real networking\n2. Component Model 1.0 enables language-agnostic composition\n3. Spin 4.0 and Wasmtime 25 add hot-reload capabilities\n4. Major CDNs (Fastly, Cloudflare) report 40%+ WASM adoption at edge',
        inputTokens: 28000,
        outputTokens: 6200,
      },
      {
        userPrompt: 'Write a brief comparison table of WASM runtimes',
        tools: [],
        assistantText: '| Runtime | Language | WASI | Components | Speed |\n|---------|----------|------|-----------|-------|\n| Wasmtime | Rust | P3 | Yes | Fast |\n| WasmEdge | C++ | P2 | Partial | Fast |\n| Wazero | Go | P2 | No | Medium |\n| V8 | C++ | P1 | No | Fast |',
        inputTokens: 15000,
        outputTokens: 2800,
      },
    ],
  },
];

// ─── JSONL File Writer ──────────────────────────────────────────────

function writeJsonlSession(session: SessionDef, baseDir: string): string {
  const sessDir = join(baseDir, session.agentId, 'sessions');
  mkdirSync(sessDir, { recursive: true });
  const filepath = join(sessDir, `session-${ts}.jsonl`);

  let time = Date.now() - 60_000; // Start 1 minute ago

  for (const turn of session.turns) {
    // User message
    appendJsonl(filepath, {
      role: 'user',
      content: turn.userPrompt,
      timestamp: new Date(time).toISOString(),
    });
    time += 500;

    // Assistant with tool_use blocks (if any)
    if (turn.tools.length > 0) {
      const toolBlocks = turn.tools.map((t) => ({
        type: 'tool_use' as const,
        id: `toolu_${nanoid(12)}`,
        name: t.name,
        input: t.input,
      }));

      appendJsonl(filepath, {
        role: 'assistant',
        content: toolBlocks,
        model: session.model,
        timestamp: new Date(time).toISOString(),
      });
      time += 300;

      // Tool results
      for (const block of toolBlocks) {
        const toolDef = turn.tools.find((t) => t.name === block.name)!;
        time += toolDef.durationMs;
        appendJsonl(filepath, {
          role: 'tool',
          tool_use_id: block.id,
          content: toolDef.output,
          timestamp: new Date(time).toISOString(),
        });
        time += 100;
      }
    }

    // Final assistant response with usage
    appendJsonl(filepath, {
      role: 'assistant',
      content: turn.assistantText,
      model: session.model,
      usage: {
        input_tokens: turn.inputTokens,
        output_tokens: turn.outputTokens,
      },
      timestamp: new Date(time).toISOString(),
    });
    time += 2000;
  }

  return filepath;
}

// ─── Pre-Normalized Event Poster ────────────────────────────────────

async function postSessionEvents(session: SessionDef): Promise<void> {
  let time = Date.now() - 60_000;
  const sessionId = `oc-${session.agentId}-sim`;

  // Session start
  await postEvent({
    id: nanoid(),
    type: 'session_start',
    sessionId,
    agentId: session.agentId,
    agentType: 'openclaw',
    model: session.model,
    vendor: session.vendor,
    timestamp: time,
    eventSource: 'openclaw',
  }, `session_start (${session.label})`);
  await sleep(100);

  // Agent start
  await postEvent({
    id: nanoid(),
    type: 'agent_start',
    sessionId,
    agentId: session.agentId,
    agentType: session.vendor,
    model: session.model,
    vendor: session.vendor,
    status: 'running',
    timestamp: time + 50,
    eventSource: 'openclaw',
  }, `agent_start (${session.vendor})`);
  await sleep(100);

  for (const turn of session.turns) {
    time += 500;

    // User prompt
    await postEvent({
      id: nanoid(),
      type: 'user_prompt',
      sessionId,
      text: turn.userPrompt,
      vendor: session.vendor,
      timestamp: time,
      eventSource: 'openclaw',
    }, `user_prompt: "${turn.userPrompt.slice(0, 40)}..."`);
    await sleep(150);

    // Tool calls
    for (const tool of turn.tools) {
      time += 200;
      const toolUseId = `toolu_${nanoid(12)}`;

      await postEvent({
        id: nanoid(),
        type: 'tool_start',
        sessionId,
        agentId: session.agentId,
        agentType: session.vendor,
        toolName: tool.name,
        toolUseId,
        toolInput: tool.input,
        status: 'running',
        model: session.model,
        vendor: session.vendor,
        timestamp: time,
        eventSource: 'openclaw',
      }, `tool_start (${tool.name})`);
      await sleep(Math.min(tool.durationMs / 2, 300));

      time += tool.durationMs;
      await postEvent({
        id: nanoid(),
        type: 'tool_end',
        sessionId,
        agentId: session.agentId,
        agentType: session.vendor,
        toolName: tool.name,
        toolUseId,
        toolResponse: { output: tool.output },
        status: 'success',
        duration: tool.durationMs,
        model: session.model,
        vendor: session.vendor,
        timestamp: time,
        eventSource: 'openclaw',
      }, `tool_end (${tool.name}, ${tool.durationMs}ms)`);
      await sleep(100);
    }

    // Result with token usage
    time += 1000;
    const cost = estimateCostSimple(session.model, turn.inputTokens, turn.outputTokens);
    await postEvent({
      id: nanoid(),
      type: 'result',
      sessionId,
      agentId: session.agentId,
      agentType: session.vendor,
      tokenUsage: { input: turn.inputTokens, output: turn.outputTokens },
      costUsd: cost > 0 ? cost : undefined,
      model: session.model,
      vendor: session.vendor,
      timestamp: time,
      eventSource: 'openclaw',
    }, `result (${turn.inputTokens}in/${turn.outputTokens}out, $${cost.toFixed(4)})`);
    await sleep(200);
  }

  // Agent stop
  time += 500;
  await postEvent({
    id: nanoid(),
    type: 'agent_stop',
    sessionId,
    agentId: session.agentId,
    agentType: session.vendor,
    status: 'success',
    model: session.model,
    vendor: session.vendor,
    timestamp: time,
    eventSource: 'openclaw',
  }, `agent_stop (${session.vendor})`);
  await sleep(100);
}

function estimateCostSimple(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6': { input: 15, output: 75 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gemini-2.0-pro': { input: 1.25, output: 5 },
  };
  const name = model.includes('/') ? model.split('/').pop()! : model;
  const p = pricing[name];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n\x1b[1mSynapse OpenClaw Simulator\x1b[0m`);
  console.log(`  Modes: ${doJsonl ? 'JSONL' : ''}${doJsonl && doPost ? ' + ' : ''}${doPost ? 'POST' : ''}`);
  console.log(`  Server: ${API_URL}\n`);

  // Write JSONL files
  if (doJsonl) {
    const baseDir = join(tmpdir(), 'synapse-openclaw-sim', 'agents');
    mkdirSync(baseDir, { recursive: true });

    console.log('\x1b[1m── JSONL Transcript Files ──\x1b[0m');
    for (const session of sessions) {
      const filepath = writeJsonlSession(session, baseDir);
      console.log(`  ${session.label}`);
      console.log(`    → ${filepath}`);
    }
    console.log(`\n  Base dir: ${join(tmpdir(), 'synapse-openclaw-sim')}`);
    console.log('  Use as watchPath in plugin config to test Layer 1\n');
  }

  // POST pre-normalized events
  if (doPost) {
    console.log('\x1b[1m── Posting Events to Synapse ──\x1b[0m');
    for (const session of sessions) {
      console.log(`\n  \x1b[36m${session.label}\x1b[0m`);
      await postSessionEvents(session);
    }
  }

  // Summary
  console.log('\n\x1b[32mSimulation complete!\x1b[0m');
  console.log('Open http://localhost:5173 to see multi-vendor sessions in the graph.\n');
  console.log('Expected sessions:');
  for (const s of sessions) {
    const totalIn = s.turns.reduce((sum, t) => sum + t.inputTokens, 0);
    const totalOut = s.turns.reduce((sum, t) => sum + t.outputTokens, 0);
    const totalTools = s.turns.reduce((sum, t) => sum + t.tools.length, 0);
    console.log(`  ${s.vendor.padEnd(10)} │ ${s.turns.length} turn${s.turns.length !== 1 ? 's' : ''} │ ${totalTools} tools │ ${totalIn}in/${totalOut}out tokens`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
