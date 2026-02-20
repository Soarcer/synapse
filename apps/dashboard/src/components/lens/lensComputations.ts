import { getKindColor } from '@synapse-ai/core';
import type { AgentNodeData, UserPromptData, AgentEvent, TranscriptSummary, FullTranscript } from '@synapse-ai/core';
import { extractUserMessage } from '../../utils/promptText';
import type {
  LensTreeNode,
  ProfileMetric,
  WaterfallSpan,
  HeatmapData,
  HeatmapCell,
  SankeyData,
  SankeyNode,
  SankeyLink,
  CompactEvent,
  CostTurn,
} from './LensContext';

/** Extract the numeric value from a tree node for the given metric */
export function nodeMetricValue(node: LensTreeNode, metric: ProfileMetric): number {
  if (metric === 'tokens') return node.tokens;
  if (metric === 'duration') return node.duration;
  return node.count;
}

// ── Waterfall derivation ────────────────────────────────────

export function buildWaterfallSpans(treeRoots: LensTreeNode[], paletteIndex = 0): WaterfallSpan[] {
  const spans: WaterfallSpan[] = [];

  function flatten(node: LensTreeNode, parentId?: string) {
    const color = getKindColor(node.kind, node.label, paletteIndex);

    spans.push({
      id: node.id,
      label: node.label,
      kind: node.kind,
      status: node.status,
      startTime: node.startTime,
      endTime: node.endTime,
      depth: node.depth,
      color,
      parentId,
      tokens: node.tokens,
    });

    for (const child of node.children) {
      flatten(child, node.id);
    }
  }

  for (const root of treeRoots) {
    flatten(root);
  }
  return spans;
}

export function computeTimeRange(spans: WaterfallSpan[]) {
  if (spans.length === 0) {
    const now = Date.now();
    return { min: now, max: now + 1000, duration: 1000 };
  }
  const min = Math.min(...spans.map((s) => s.startTime));
  const max = Math.max(...spans.map((s) => s.endTime ?? Date.now()));
  return { min, max, duration: Math.max(max - min, 1000) };
}

// ── Heatmap derivation ──────────────────────────────────────

const BUCKET_COUNT = 20;

export function buildHeatmapData(
  waterfallSpans: WaterfallSpan[],
  timeRange: { min: number; max: number; duration: number },
): HeatmapData {
  const empty: HeatmapData = { actions: [], bucketLabels: [], grid: [], maxCount: 0, tokenGrid: [], maxTokens: 0 };
  // Only consider tool and agent spans
  const actionSpans = waterfallSpans.filter((s) => s.kind === 'tool' || s.kind === 'agent');
  if (actionSpans.length === 0) return empty;

  const bucketSize = timeRange.duration / BUCKET_COUNT;

  // Count + collect IDs + tokens per action per bucket
  const actionBuckets = new Map<string, { count: number; ids: string[]; tokens: number }[]>();
  const actionTotals = new Map<string, number>();

  for (const span of actionSpans) {
    const name = span.label.replace(/ x\d+$/, ''); // strip group suffix
    if (!actionBuckets.has(name)) {
      actionBuckets.set(
        name,
        Array.from({ length: BUCKET_COUNT }, () => ({ count: 0, ids: [] as string[], tokens: 0 })),
      );
      actionTotals.set(name, 0);
    }
    const buckets = actionBuckets.get(name)!;
    const startBucket = Math.min(
      BUCKET_COUNT - 1,
      Math.max(0, Math.floor((span.startTime - timeRange.min) / bucketSize)),
    );
    const endTime = span.endTime ?? Date.now();
    const endBucket = Math.min(
      BUCKET_COUNT - 1,
      Math.max(0, Math.floor((endTime - timeRange.min) / bucketSize)),
    );
    // Mark all buckets this span covers
    for (let b = startBucket; b <= endBucket; b++) {
      buckets[b].count++;
      buckets[b].ids.push(span.id);
      buckets[b].tokens += span.tokens;
    }
    actionTotals.set(name, (actionTotals.get(name) ?? 0) + 1);
  }

  // Sort actions by total count desc
  const actions = [...actionBuckets.keys()].sort(
    (a, b) => (actionTotals.get(b) ?? 0) - (actionTotals.get(a) ?? 0),
  );

  // Build grids (count + token)
  let maxCount = 0;
  let maxTokens = 0;
  const grid: HeatmapCell[][] = [];
  const tokenGrid: number[][] = [];

  for (const action of actions) {
    const buckets = actionBuckets.get(action)!;
    const countRow: HeatmapCell[] = [];
    const tokenRow: number[] = [];
    for (const cell of buckets) {
      if (cell.count > maxCount) maxCount = cell.count;
      if (cell.tokens > maxTokens) maxTokens = cell.tokens;
      countRow.push({ count: cell.count, ids: cell.ids });
      tokenRow.push(cell.tokens);
    }
    grid.push(countRow);
    tokenGrid.push(tokenRow);
  }

  // Bucket labels (relative time from start)
  const bucketLabels: string[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const ms = i * bucketSize;
    if (ms < 1000) bucketLabels.push(`${Math.round(ms)}ms`);
    else if (ms < 60000) bucketLabels.push(`${(ms / 1000).toFixed(0)}s`);
    else bucketLabels.push(`${(ms / 60000).toFixed(1)}m`);
  }

  return { actions, bucketLabels, grid, maxCount, tokenGrid, maxTokens };
}

// ── Sankey derivation ───────────────────────────────────────

export function buildSankeyData(
  treeRoots: LensTreeNode[],
  metric: ProfileMetric,
  paletteIndex = 0,
): SankeyData {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const seen = new Set<string>();

  function layerFor(node: LensTreeNode): number {
    return Math.min(node.depth, 3);
  }

  function addNode(node: LensTreeNode) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const value = nodeMetricValue(node, metric);
    nodes.push({
      id: node.id,
      label: node.kind === 'tool' && node.groupCount ? `${node.label}` : node.label,
      kind: node.kind,
      layer: layerFor(node),
      value,
      color: getKindColor(node.kind, node.label, paletteIndex),
    });
  }

  function walk(node: LensTreeNode) {
    addNode(node);
    for (const child of node.children) {
      // Skip individual tools inside a grouped tool
      if (node.kind === 'tool' && child.kind === 'tool') continue;

      addNode(child);
      const value = nodeMetricValue(child, metric);
      links.push({ source: node.id, target: child.id, value: Math.max(value, 1) });
      walk(child);
    }
  }

  for (const root of treeRoots) walk(root);
  return { nodes, links };
}

// ── Compaction & cost derivation ─────────────────────────────

export function buildCompactEvents(
  events: AgentEvent[],
  fullTranscripts?: Map<string, FullTranscript>,
): CompactEvent[] {
  const hookEvents: CompactEvent[] = events
    .filter((e) => e.type === 'compact')
    .map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      timestamp: e.timestamp,
      trigger: e.compactTrigger,
    }));

  // Merge preTokens from transcript v2 CompactBoundaryRecord data when available
  if (fullTranscripts) {
    for (const [sessionId, ft] of fullTranscripts) {
      const boundaries = ft.system.filter((s) => s.type === 'compact_boundary');
      for (const b of boundaries) {
        if (b.type !== 'compact_boundary') continue;
        // Try to match to an existing hook event by timestamp (within 2s tolerance)
        const match = hookEvents.find(
          (h) => h.sessionId === sessionId && Math.abs(h.timestamp - b.timestamp) < 2000,
        );
        if (match) {
          match.preTokens = b.preTokens;
          if (!match.trigger && b.trigger) match.trigger = b.trigger;
        } else {
          // Transcript has a compaction event not seen in hooks — add it
          hookEvents.push({
            id: `compact-tx-${b.timestamp}`,
            sessionId,
            timestamp: b.timestamp,
            trigger: b.trigger,
            preTokens: b.preTokens,
          });
        }
      }
    }
  }

  return hookEvents.sort((a, b) => a.timestamp - b.timestamp);
}

export function buildCostPerTurn(
  prompts: Map<string, UserPromptData[]>,
  agents: Map<string, AgentNodeData>,
  compactEvents: CompactEvent[],
  transcripts: Map<string, TranscriptSummary>,
): CostTurn[] {
  const turns: CostTurn[] = [];

  for (const [sessionId, sessionPrompts] of prompts) {
    const sorted = [...sessionPrompts].sort((a, b) => a.timestamp - b.timestamp);
    let cumInput = 0;
    let cumOutput = 0;

    // Get transcript turns for this session (if available)
    const transcript = transcripts.get(sessionId);
    // TODO: When full transcript data (ConversationRecord[]) is available via LensAdapter,
    // filter out isMeta records here to prevent /skill invocations and system-injected
    // content from appearing as user prompts in the cost lens.
    const tTurns = transcript?.turns.filter((t) => t.type === 'assistant') ?? [];

    for (let i = 0; i < sorted.length; i++) {
      const prompt = sorted[i];
      const next = sorted[i + 1];

      // Sum tokens and tool calls from agents active during this turn (hook data)
      let turnInput = 0;
      let turnOutput = 0;
      let turnToolCount = 0;
      for (const a of agents.values()) {
        if (
          a.sessionId === sessionId &&
          a.startTime >= prompt.timestamp &&
          (!next || a.startTime < next.timestamp)
        ) {
          turnInput += a.tokenUsage.input;
          turnOutput += a.tokenUsage.output;
          turnToolCount += a.toolCalls.length;
        }
      }

      // Try transcript data: find assistant turns between this prompt and next
      let cacheReadTokens: number | undefined;
      let cacheCreationTokens: number | undefined;
      let model: string | undefined;
      let responseLatencyMs: number | undefined;
      let thinkingLength: number | undefined;
      let textLength: number | undefined;
      let dataSource: 'hook' | 'transcript' = 'hook';

      if (tTurns.length > 0) {
        // Find transcript assistant turns in this prompt's time window
        const windowStart = prompt.timestamp - 2000;
        const windowEnd = next ? next.timestamp : prompt.timestamp + 600_000;
        const matched = tTurns.filter(
          (t) => t.timestamp >= windowStart && t.timestamp < windowEnd,
        );

        if (matched.length > 0) {
          let txInput = 0;
          let txOutput = 0;
          let txCacheRead = 0;
          let txCacheCreation = 0;
          let txThinking = 0;
          let txText = 0;
          let txToolCount = 0;

          for (const m of matched) {
            txInput += m.totalInputTokens;
            txOutput += m.outputTokens;
            txCacheRead += m.cacheReadTokens;
            txCacheCreation += m.cacheCreationTokens;
            txThinking += m.thinkingLength;
            txText += m.textLength;
            txToolCount += m.toolUseCount;
          }

          // Override with transcript data
          turnInput = txInput;
          turnOutput = txOutput;
          cacheReadTokens = txCacheRead;
          cacheCreationTokens = txCacheCreation;
          model = matched[0].model;
          thinkingLength = txThinking;
          textLength = txText;
          dataSource = 'transcript';
          if (turnToolCount === 0) turnToolCount = txToolCount;

          // Compute response latency (first assistant response after prompt)
          const firstAssistant = matched[0];
          if (firstAssistant.timestamp > prompt.timestamp) {
            responseLatencyMs = firstAssistant.timestamp - prompt.timestamp;
          }
        }
      }

      cumInput += turnInput;
      cumOutput += turnOutput;

      // Check if a compaction happened between previous turn and this one
      const prevTime = i > 0 ? sorted[i - 1].timestamp : 0;
      const compactionBefore = compactEvents.some(
        (c) => c.sessionId === sessionId && c.timestamp > prevTime && c.timestamp <= prompt.timestamp,
      );

      turns.push({
        promptId: prompt.id,
        promptText: extractUserMessage(prompt.text),
        sessionId,
        timestamp: prompt.timestamp,
        turnIndex: i,
        inputTokens: turnInput,
        outputTokens: turnOutput,
        cumulativeInput: cumInput,
        cumulativeOutput: cumOutput,
        toolCount: turnToolCount,
        compactionBefore,
        cacheReadTokens,
        cacheCreationTokens,
        model,
        responseLatencyMs,
        thinkingLength,
        textLength,
        dataSource,
      });
    }
  }

  return turns.sort((a, b) => a.timestamp - b.timestamp);
}
