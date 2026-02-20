import { parseThinking } from '../services/thinkingParser.js';

describe('parseThinking', () => {
  it('returns null for null input', () => {
    expect(parseThinking(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseThinking('')).toBeNull();
  });

  it('extracts intent from "I need to" pattern', () => {
    const text = 'I need to find the authentication files in this project. Let me search for them.';
    const result = parseThinking(text)!;
    expect(result.intent).toContain('find the authentication files');
  });

  it('extracts intent from "The user wants" pattern', () => {
    const text = 'The user wants to fix a bug in the login handler. I should look at the code first.';
    const result = parseThinking(text)!;
    expect(result.intent).toContain('fix a bug');
  });

  it('extracts numbered plan steps', () => {
    const text = `I need to fix this bug. Here's my plan:
1. Find the relevant files
2. Read the current implementation
3. Identify the issue
4. Apply the fix

Let me start with step 1.`;
    const result = parseThinking(text)!;
    expect(result.planSteps).toHaveLength(4);
    expect(result.planSteps[0].text).toContain('Find the relevant files');
    expect(result.planSteps[0].done).toBe(false);
  });

  it('extracts decision from "I\'ll" pattern', () => {
    const text = 'After looking at the results, I\'ll use grep to search for the auth handler since it\'s the fastest approach.';
    const result = parseThinking(text)!;
    expect(result.decision).toContain('grep');
  });

  it('extracts high confidence', () => {
    const text = 'I\'m confident this is the bug. The comparison uses < instead of <=.';
    const result = parseThinking(text)!;
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('extracts medium confidence', () => {
    const text = 'I think this is probably the issue, but I should verify.';
    const result = parseThinking(text)!;
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('extracts low confidence', () => {
    const text = 'I\'m not sure what the issue is. Let me try looking at the logs.';
    const result = parseThinking(text)!;
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns null confidence when no signals', () => {
    const text = 'Reading the file contents to understand the structure.';
    const result = parseThinking(text)!;
    expect(result.confidence).toBeNull();
  });

  it('handles thinking with no clear structure', () => {
    const text = 'Looking at this code.';
    const result = parseThinking(text)!;
    expect(result.intent).not.toBeNull();
    expect(result.planSteps).toEqual([]);
    expect(result.decision).toBeNull();
  });
});
