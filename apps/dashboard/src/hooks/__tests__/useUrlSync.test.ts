// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom

import { parseUrlState, buildUrlParams } from '../useUrlSync';

describe('parseUrlState', () => {
  it('parses session param', () => {
    const result = parseUrlState(new URLSearchParams('?session=abc'));
    expect(result.sessionId).toBe('abc');
  });

  it('parses node param', () => {
    const result = parseUrlState(new URLSearchParams('?node=agent-1'));
    expect(result.nodeId).toBe('agent-1');
  });

  it('parses tab param', () => {
    const result = parseUrlState(new URLSearchParams('?tab=cost'));
    expect(result.tab).toBe('cost');
  });

  it('parses q param with URI decoding', () => {
    const result = parseUrlState(new URLSearchParams('?q=Read%20file'));
    expect(result.query).toBe('Read file');
  });

  it('returns undefined for missing params', () => {
    const result = parseUrlState(new URLSearchParams(''));
    expect(result.sessionId).toBeUndefined();
    expect(result.nodeId).toBeUndefined();
    expect(result.tab).toBeUndefined();
    expect(result.query).toBeUndefined();
  });
});

describe('buildUrlParams', () => {
  it('builds params from state', () => {
    const params = buildUrlParams({
      sessionId: 'abc',
      nodeId: 'agent-1',
      tab: 'cost',
      query: 'Read',
    });
    expect(params.get('session')).toBe('abc');
    expect(params.get('node')).toBe('agent-1');
    expect(params.get('tab')).toBe('cost');
    expect(params.get('q')).toBe('Read');
  });

  it('omits null/undefined/empty values', () => {
    const params = buildUrlParams({
      sessionId: undefined,
      nodeId: null,
      tab: '',
      query: undefined,
    });
    expect(params.toString()).toBe('');
  });

  it('preserves existing view and cwd params', () => {
    const params = buildUrlParams(
      { sessionId: 'abc' },
      new URLSearchParams('?view=full&cwd=/proj'),
    );
    expect(params.get('view')).toBe('full');
    expect(params.get('cwd')).toBe('/proj');
    expect(params.get('session')).toBe('abc');
  });
});
