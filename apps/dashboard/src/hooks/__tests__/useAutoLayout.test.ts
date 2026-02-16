import type { Node, Edge } from '@xyflow/react';
import { computeGraphLayout } from '../useAutoLayout';

// ── Helpers ──────────────────────────────────────────────────

function makeNode(
  id: string,
  type: string,
  measured?: { width: number; height: number },
): Node {
  return {
    id,
    type,
    position: { x: -9999, y: -9999 },
    data: {},
    ...(measured ? { measured } : {}),
  };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `edge-${source}-${target}`, source, target };
}

// ── Tests ────────────────────────────────────────────────────

describe('computeGraphLayout', () => {
  it('positions all nodes (no orphans at -9999)', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('agent-1', 'agent'),
      makeNode('tool-1', 'toolCall'),
    ];
    const edges = [
      makeEdge('session-1', 'agent-1'),
      makeEdge('agent-1', 'tool-1'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    expect(positions.size).toBe(3);
    for (const [, pos] of positions) {
      expect(pos.x).not.toBe(-9999);
      expect(pos.y).not.toBe(-9999);
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('lays out children to the right of their parents (LR direction)', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('agent-1', 'agent'),
    ];
    const edges = [makeEdge('session-1', 'agent-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);
    const sessionPos = positions.get('session-1')!;
    const agentPos = positions.get('agent-1')!;

    // Agent should be to the right of session
    expect(agentPos.x).toBeGreaterThan(sessionPos.x);
    // Gap should be at least node width + GAP_X (220 + 40 = 260)
    expect(agentPos.x).toBeGreaterThanOrEqual(sessionPos.x + 220 + 40);
  });

  it('uses measured dimensions when available', () => {
    const nodesDefault = [
      makeNode('session-1', 'session'), // defaults: 220x80
      makeNode('agent-1', 'agent'),     // defaults: 200x110
    ];
    const nodesWider = [
      makeNode('session-1', 'session', { width: 300, height: 80 }), // wider
      makeNode('agent-1', 'agent'),
    ];
    const edges = [makeEdge('session-1', 'agent-1')];

    const r1 = computeGraphLayout(nodesDefault, edges, null);
    const r2 = computeGraphLayout(nodesWider, edges, null);

    const agentX1 = r1.positions.get('agent-1')!.x;
    const agentX2 = r2.positions.get('agent-1')!.x;

    // With a wider session node, the agent should be pushed further right
    expect(agentX2).toBeGreaterThan(agentX1);
    // Difference should be exactly the width difference (300 - 220 = 80)
    expect(agentX2 - agentX1).toBe(80);
  });

  it('vertically centers parent and child handles when both are measured', () => {
    const nodes = [
      makeNode('agent-1', 'agent', { width: 200, height: 110 }),
      makeNode('tool-1', 'toolCall', { width: 150, height: 40 }),
    ];
    // Tool is a leaf tool (no children) → goes into stacked layout
    const edges = [makeEdge('agent-1', 'tool-1')];

    const { positions } = computeGraphLayout(nodes, edges, null);
    const agentPos = positions.get('agent-1')!;
    const toolPos = positions.get('tool-1')!;

    // Both should have the same vertical center
    const agentCenter = agentPos.y + 110 / 2;
    const toolCenter = toolPos.y + 40 / 2;
    // Stacked tools start at childY which is centered in subtree,
    // and agent is centered in subtree too — both centers should match
    expect(agentCenter).toBeCloseTo(toolCenter, 0);
  });

  it('positions orphan nodes (no edges) without errors', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('orphan-1', 'agent'),
    ];
    const edges: Edge[] = []; // no edges at all

    const { positions } = computeGraphLayout(nodes, edges, null);

    expect(positions.size).toBe(2);
    // Orphan should be positioned below the session (both are roots)
    const sessionY = positions.get('session-1')!.y;
    const orphanY = positions.get('orphan-1')!.y;
    expect(orphanY).toBeGreaterThan(sessionY);
  });

  it('handles a deep chain: session → prompt → agent → tool', () => {
    const nodes = [
      makeNode('session-1', 'session'),
      makeNode('prompt-1', 'userPrompt'),
      makeNode('agent-1', 'agent'),
      makeNode('tool-1', 'toolCall'),
    ];
    const edges = [
      makeEdge('session-1', 'prompt-1'),
      makeEdge('prompt-1', 'agent-1'),
      makeEdge('agent-1', 'tool-1'),
    ];

    const { positions } = computeGraphLayout(nodes, edges, null);

    // Each node should be progressively further right
    const sx = positions.get('session-1')!.x;
    const px = positions.get('prompt-1')!.x;
    const ax = positions.get('agent-1')!.x;
    const tx = positions.get('tool-1')!.x;

    expect(px).toBeGreaterThan(sx);
    expect(ax).toBeGreaterThan(px);
    expect(tx).toBeGreaterThan(ax);
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
    const tools = Array.from({ length: 3 }, (_, i) =>
      makeNode(`tool-${i}`, 'toolCall'),
    );
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

    // tool-task has children → classified as "others" not "tools"
    // All three should have positions
    expect(positions.size).toBe(3);

    // Child agent should be further right than tool
    const toolX = positions.get('tool-task')!.x;
    const childX = positions.get('agent-child')!.x;
    expect(childX).toBeGreaterThan(toolX);
  });
});
