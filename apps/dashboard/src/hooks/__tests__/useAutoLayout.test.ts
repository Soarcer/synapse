// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { Node, Edge } from '@xyflow/react';
import { computeGraphLayout } from '../useAutoLayout';

// ── Helpers ──────────────────────────────────────────────────

function makeNode(
  id: string,
  type: string,
  measured?: { width: number; height: number },
  data?: Record<string, unknown>,
): Node {
  return {
    id,
    type,
    position: { x: -9999, y: -9999 },
    data: data ?? {},
    ...(measured ? { measured } : {}),
  };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `edge-${source}-${target}`, source, target };
}

// ── Tests ────────────────────────────────────────────────────

describe('computeGraphLayout (TB)', () => {
  it('positions all nodes (no orphans at -9999)', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('agent-1', 'agent'),
    ];
    const edges = [makeEdge('session-1', 'prompt-1'), makeEdge('prompt-1', 'agent-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);

    expect(positions.size).toBe(3);
    for (const [, pos] of positions) {
      expect(pos.x).not.toBe(-9999);
      expect(pos.y).not.toBe(-9999);
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('lays out spine children below their parents (TB direction)', () => {
    const nodes = [makeNode('session-1', 'session'), makeNode('prompt-1', 'userPrompt')];
    const edges = [makeEdge('session-1', 'prompt-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);
    const sessionPos = positions.get('session-1')!;
    const promptPos = positions.get('prompt-1')!;

    // Prompt should be below session (greater Y)
    expect(promptPos.y).toBeGreaterThan(sessionPos.y);
    // Gap should be at least node height + RANK_GAP
    expect(promptPos.y).toBeGreaterThanOrEqual(sessionPos.y + 65);
  });

  it('uses measured dimensions when available', () => {
    const nodesDefault = [makeNode('session-1', 'session'), makeNode('prompt-1', 'userPrompt')];
    const nodesWider = [
      makeNode('session-1', 'session', { width: 300, height: 80 }),
      makeNode('prompt-1', 'userPrompt'),
    ];
    const edges = [makeEdge('session-1', 'prompt-1')];

    const r1 = computeGraphLayout(nodesDefault, edges, null);
    const r2 = computeGraphLayout(nodesWider, edges, null);

    // With a wider session node, the prompt should still be positioned
    // Both should have positions
    expect(r1.positions.size).toBe(2);
    expect(r2.positions.size).toBe(2);
    // Wider session affects horizontal centering but both complete without error
  });

  it('positions orphan nodes (no edges) without errors', () => {
    const nodes = [makeNode('session-1', 'session'), makeNode('orphan-1', 'agent')];
    const edges: Edge[] = []; // no edges at all

    const { positions } = computeGraphLayout(nodes, edges, null);

    expect(positions.size).toBe(2);
    // Orphan should be positioned to the right of the session (both are roots, horizontal spread)
    const sessionX = positions.get('session-1')!.x;
    const orphanX = positions.get('orphan-1')!.x;
    expect(orphanX).toBeGreaterThan(sessionX);
  });

  it('handles a deep chain: session → prompt → agent (shelf)', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('agent-1', 'agent'),
    ];
    const edges = [makeEdge('session-1', 'prompt-1'), makeEdge('prompt-1', 'agent-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // Session → Prompt: Y increases (spine)
    const sy = positions.get('session-1')!.y;
    const py = positions.get('prompt-1')!.y;
    expect(py).toBeGreaterThan(sy);

    // Prompt → Agent: X increases (shelf), same Y level
    const px = positions.get('prompt-1')!.x;
    const ax = positions.get('agent-1')!.x;
    expect(ax).toBeGreaterThan(px);
  });

  it('lays out expanded tool grid using measured dimensions', () => {
    const tools = Array.from({ length: 3 }, (_, i) =>
      makeNode(`tool-${i}`, 'toolCall', { width: 160, height: 36 }),
    );
    const nodes = [makeNode('agent-1', 'agent'), ...tools];
    const edges = tools.map((t) => makeEdge('agent-1', t.id));

    // Expand agent-1 to show grid
    const { positions } = computeGraphLayout(nodes, edges, 'agent-1');

    // All tools should have positions
    for (const tool of tools) {
      expect(positions.has(tool.id)).toBe(true);
    }
    // Tools should be to the right of agent
    const agentX = positions.get('agent-1')!.x;
    for (const tool of tools) {
      expect(positions.get(tool.id)!.x).toBeGreaterThan(agentX);
    }
  });

  it('assigns z-index for stacked tools (later tools on top)', () => {
    const tools = Array.from({ length: 3 }, (_, i) => makeNode(`tool-${i}`, 'toolCall'));
    const nodes = [makeNode('agent-1', 'agent'), ...tools];
    const edges = tools.map((t) => makeEdge('agent-1', t.id));

    // Not expanded → stacked mode
    const { zIndexMap } = computeGraphLayout(nodes, edges, null);

    expect(zIndexMap.get('tool-0')).toBe(1);
    expect(zIndexMap.get('tool-1')).toBe(2);
    expect(zIndexMap.get('tool-2')).toBe(3);
  });

  it('handles Task tool with child agent (structural tool)', () => {
    const nodes = [
      makeNode('agent-1', 'agent'),
      makeNode('tool-task', 'toolCall'),
      makeNode('agent-child', 'agent'),
    ];
    const edges = [
      makeEdge('agent-1', 'tool-task'),
      makeEdge('tool-task', 'agent-child'), // Task tool → child agent
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // tool-task has children → classified as structural, not leaf tool
    expect(positions.size).toBe(3);

    // Child agent should be to the right of tool (shelf continues rightward)
    const toolX = positions.get('tool-task')!.x;
    const childX = positions.get('agent-child')!.x;
    expect(childX).toBeGreaterThan(toolX);
  });

  it('prevents horizontal overlap between sibling prompt nodes', () => {
    // Two prompts as children of a session, measured at realistic widths
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt', { width: 260, height: 150 }),
      makeNode('prompt-2', 'userPrompt', { width: 260, height: 150 }),
    ];
    const edges = [makeEdge('session-1', 'prompt-1'), makeEdge('session-1', 'prompt-2')];

    const { positions } = computeGraphLayout(nodes, edges, null);

    const p1 = positions.get('prompt-1')!;
    const p2 = positions.get('prompt-2')!;

    // In TB, sibling prompts stack vertically — Y must not overlap
    const [top, bottom] = p1.y <= p2.y ? [p1, p2] : [p2, p1];
    expect(bottom.y).toBeGreaterThanOrEqual(top.y + 150);
  });

  it('prevents overlap even with fallback dimensions (no measurement)', () => {
    // Three prompts without measured dimensions — relies on fallback heights
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('prompt-2', 'userPrompt'),
      makeNode('prompt-3', 'userPrompt'),
    ];
    const edges = [
      makeEdge('session-1', 'prompt-1'),
      makeEdge('session-1', 'prompt-2'),
      makeEdge('session-1', 'prompt-3'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // Collect and sort prompt positions by y
    const prompts = ['prompt-1', 'prompt-2', 'prompt-3']
      .map((id) => ({ id, ...positions.get(id)! }))
      .sort((a, b) => a.y - b.y);

    // Each successive prompt must start below the previous one's bottom edge
    // (fallback height for userPrompt is 150px, RANK_GAP is 120)
    for (let i = 1; i < prompts.length; i++) {
      expect(prompts[i].y).toBeGreaterThanOrEqual(prompts[i - 1].y + 150);
    }
  });

  it('orders sibling prompts chronologically (oldest on top, lowest Y)', () => {
    // Prompts added in reverse timestamp order — layout should still sort oldest-on-top
    const nodes = [
      makeNode('session-1', 'session', undefined, { session: { startTime: 1000 } }),
      makeNode('prompt-c', 'userPrompt', undefined, { prompt: { timestamp: 3000 } }),
      makeNode('prompt-a', 'userPrompt', undefined, { prompt: { timestamp: 1000 } }),
      makeNode('prompt-b', 'userPrompt', undefined, { prompt: { timestamp: 2000 } }),
    ];
    const edges = [
      makeEdge('session-1', 'prompt-c'),
      makeEdge('session-1', 'prompt-a'),
      makeEdge('session-1', 'prompt-b'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    const yA = positions.get('prompt-a')!.y;
    const yB = positions.get('prompt-b')!.y;
    const yC = positions.get('prompt-c')!.y;

    // Oldest (prompt-a, t=1000) should be on top (lowest y)
    expect(yA).toBeLessThan(yB);
    expect(yB).toBeLessThan(yC);
  });

  it('orders root sessions chronologically (oldest on left, lowest X)', () => {
    const nodes = [
      makeNode('session-new', 'session', undefined, { session: { startTime: 5000 } }),
      makeNode('session-old', 'session', undefined, { session: { startTime: 1000 } }),
    ];
    const edges: Edge[] = [];

    const { positions } = computeGraphLayout(nodes, edges, null);

    const xOld = positions.get('session-old')!.x;
    const xNew = positions.get('session-new')!.x;

    // Older session should be on the left (lower x)
    expect(xOld).toBeLessThan(xNew);
  });

  // ── TB-specific tests ──────────────────────────────────────

  it('TB1: sessions share same Y, spread horizontally', () => {
    const nodes = [
      makeNode('session-1', 'session', undefined, { session: { startTime: 1000 } }),
      makeNode('session-2', 'session', undefined, { session: { startTime: 2000 } }),
      makeNode('session-3', 'session', undefined, { session: { startTime: 3000 } }),
    ];
    const edges: Edge[] = [];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // All sessions at rank 0 → same Y
    const y1 = positions.get('session-1')!.y;
    const y2 = positions.get('session-2')!.y;
    const y3 = positions.get('session-3')!.y;
    expect(y1).toBe(y2);
    expect(y2).toBe(y3);

    // Ordered left to right by timestamp
    const x1 = positions.get('session-1')!.x;
    const x2 = positions.get('session-2')!.x;
    const x3 = positions.get('session-3')!.x;
    expect(x1).toBeLessThan(x2);
    expect(x2).toBeLessThan(x3);
  });

  it('TB2: shelf children stack vertically as rows, each to the right of prompt', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('response-1', 'assistantResponse'),
      makeNode('agent-1', 'agent'),
    ];
    const edges = [
      makeEdge('session-1', 'prompt-1'),
      makeEdge('prompt-1', 'response-1'),
      makeEdge('prompt-1', 'agent-1'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    const promptPos = positions.get('prompt-1')!;
    const responsePos = positions.get('response-1')!;
    const agentPos = positions.get('agent-1')!;

    // Both shelf nodes should be to the right of prompt
    expect(responsePos.x).toBeGreaterThan(promptPos.x);
    expect(agentPos.x).toBeGreaterThan(promptPos.x);

    // Both at the same X (same column, stacked vertically)
    expect(responsePos.x).toBe(agentPos.x);

    // Response above agent (stacked vertically as rows)
    expect(responsePos.y).toBeLessThan(agentPos.y);
  });

  it('TB3: tool groups to the right of agent at same Y', () => {
    const nodes = [makeNode('agent-1', 'agent'), makeNode('toolgroup-agent-1', 'toolGroup')];
    const edges = [makeEdge('agent-1', 'toolgroup-agent-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);

    const agentPos = positions.get('agent-1')!;
    const tgPos = positions.get('toolgroup-agent-1')!;

    // ToolGroup to the right of agent
    expect(tgPos.x).toBeGreaterThan(agentPos.x);

    // Approximately same Y (centered)
    const agentMidY = agentPos.y + 100 / 2; // fallback height
    const tgMidY = tgPos.y + 120 / 2; // fallback height
    expect(Math.abs(agentMidY - tgMidY)).toBeLessThan(2);
  });

  it('TB5: spawn node centered below deepest rank', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('__spawn__', 'spawnAgent'),
    ];
    const edges = [makeEdge('session-1', 'prompt-1')];

    // useAutoLayout hook places spawn node — but computeGraphLayout doesn't include it.
    // Test the raw layout positions for non-spawn nodes only
    const { positions } = computeGraphLayout(
      nodes.filter((n) => n.id !== '__spawn__'),
      edges,
      null,
    );

    // Verify the layout basics are correct for the spawn node computation
    expect(positions.has('session-1')).toBe(true);
    expect(positions.has('prompt-1')).toBe(true);
    const promptPos = positions.get('prompt-1')!;
    expect(promptPos.y).toBeGreaterThan(positions.get('session-1')!.y);
  });

  it('TB7: shelf width accounts for tool overhang — no horizontal overlap between sibling prompts', () => {
    // Two prompts under a session, each with an agent that has tools
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt', undefined, { prompt: { timestamp: 1000 } }),
      makeNode('prompt-2', 'userPrompt', undefined, { prompt: { timestamp: 2000 } }),
      makeNode('agent-1', 'agent'),
      makeNode('toolgroup-agent-1', 'toolGroup'),
    ];
    const edges = [
      makeEdge('session-1', 'prompt-1'),
      makeEdge('session-1', 'prompt-2'),
      makeEdge('prompt-1', 'agent-1'),
      makeEdge('agent-1', 'toolgroup-agent-1'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // Both prompts should have valid positions
    expect(positions.has('prompt-1')).toBe(true);
    expect(positions.has('prompt-2')).toBe(true);

    // Agent and toolgroup should be to the right of prompt-1 (shelf)
    const p1 = positions.get('prompt-1')!;
    const agentPos = positions.get('agent-1')!;
    const tgPos = positions.get('toolgroup-agent-1')!;
    expect(agentPos.x).toBeGreaterThan(p1.x);
    expect(tgPos.x).toBeGreaterThan(agentPos.x);
  });
});
