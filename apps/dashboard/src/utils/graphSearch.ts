import type { Node } from '@xyflow/react';
import type {
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
} from '@synapse-ai/core';

export function nodeMatchesSearch(node: Node, query: string): boolean {
  if (node.id === '__spawn__') return false;
  const d = node.data as Record<string, unknown>;

  switch (node.type) {
    case 'session': {
      const s = d.session as SessionData;
      return [s.sessionId, s.model, s.cwd].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    case 'userPrompt': {
      const p = d.prompt as UserPromptData;
      return p.text.toLowerCase().includes(query);
    }
    case 'agent': {
      const a = d.agent as AgentNodeData;
      return [a.agentType, a.agentId].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    case 'toolCall': {
      const t = d.toolCall as ToolCallSummary;
      return [t.toolName, t.inputPreview].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    default:
      return false;
  }
}

/** Build a child->parent map from edges */
export function buildParentMap(edges: { source: string; target: string }[]): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    parentOf.set(edge.target, edge.source);
  }
  return parentOf;
}

/** Collect a node's ancestors by walking up the parent map */
export function collectAncestors(id: string, parentOf: Map<string, string>, into: Set<string>): void {
  let current = id;
  while (parentOf.has(current)) {
    current = parentOf.get(current)!;
    into.add(current);
  }
}

/** Build a parent->children map from edges */
export function buildChildrenMap(edges: { source: string; target: string }[]): Map<string, string[]> {
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const kids = childrenOf.get(edge.source) ?? [];
    kids.push(edge.target);
    childrenOf.set(edge.source, kids);
  }
  return childrenOf;
}
