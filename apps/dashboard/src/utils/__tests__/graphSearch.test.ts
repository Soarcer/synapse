// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { buildParentMap, buildChildrenMap, collectAncestors } from '../graphSearch';

const edges = [
  { source: 'A', target: 'B' },
  { source: 'A', target: 'C' },
  { source: 'B', target: 'D' },
  { source: 'B', target: 'E' },
  { source: 'C', target: 'F' },
];

describe('buildParentMap', () => {
  it('maps each target to its source', () => {
    const parentOf = buildParentMap(edges);
    expect(parentOf.get('B')).toBe('A');
    expect(parentOf.get('C')).toBe('A');
    expect(parentOf.get('D')).toBe('B');
    expect(parentOf.get('F')).toBe('C');
    expect(parentOf.has('A')).toBe(false);
  });

  it('returns empty map for empty edges', () => {
    expect(buildParentMap([]).size).toBe(0);
  });
});

describe('buildChildrenMap', () => {
  it('maps each source to its targets', () => {
    const childrenOf = buildChildrenMap(edges);
    expect(childrenOf.get('A')).toEqual(['B', 'C']);
    expect(childrenOf.get('B')).toEqual(['D', 'E']);
    expect(childrenOf.get('C')).toEqual(['F']);
    expect(childrenOf.has('D')).toBe(false);
    expect(childrenOf.has('F')).toBe(false);
  });

  it('returns empty map for empty edges', () => {
    expect(buildChildrenMap([]).size).toBe(0);
  });
});

describe('collectAncestors', () => {
  const parentOf = buildParentMap(edges);

  it('walks up and collects all ancestors', () => {
    const into = new Set<string>();
    collectAncestors('D', parentOf, into);
    expect(into).toEqual(new Set(['B', 'A']));
  });

  it('collects nothing for a root node', () => {
    const into = new Set<string>();
    collectAncestors('A', parentOf, into);
    expect(into.size).toBe(0);
  });

  it('collects single parent for depth-1 node', () => {
    const into = new Set<string>();
    collectAncestors('F', parentOf, into);
    expect(into).toEqual(new Set(['C', 'A']));
  });
});
