// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { ReactNode } from 'react';

// ── Language detection from file extension ─────────────────────

const EXT_MAP: Record<string, string> = {
  '.json': 'json',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.css': 'css',
  '.scss': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'md',
  '.mdx': 'md',
  '.py': 'py',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'shell',
  '.sql': 'sql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'html',
  '.svg': 'html',
};

export function detectLang(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return 'text';
  return EXT_MAP[filePath.slice(dot).toLowerCase()] ?? 'text';
}

// ── Token types & colors ───────────────────────────────────────

const C = {
  key: 'text-blue-400',
  str: 'text-green-400',
  num: 'text-amber-400',
  bool: 'text-purple-400',
  null: 'text-purple-400',
  punct: 'text-gray-500',
  kw: 'text-purple-400',
  fn: 'text-yellow-300',
  comment: 'text-gray-600 italic',
  flag: 'text-cyan-400',
  op: 'text-purple-400',
  tag: 'text-red-400',
  attr: 'text-amber-400',
  type: 'text-cyan-400',
};

// ── JSON highlighter ───────────────────────────────────────────

const JSON_RE =
  /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;

export function highlightJSON(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  JSON_RE.lastIndex = 0;
  while ((match = JSON_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const [full, key, str, num, bool, nul, punct] = match;
    let cls = '';
    if (key) cls = C.key;
    else if (str) cls = C.str;
    else if (num) cls = C.num;
    else if (bool) cls = C.bool;
    else if (nul) cls = C.null;
    else if (punct) cls = C.punct;

    tokens.push(
      <span key={match.index} className={cls}>
        {full}
      </span>,
    );
    lastIndex = JSON_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

// ── Shell highlighter ──────────────────────────────────────────

const SHELL_RE =
  /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\w+|\$\{[^}]+\})|(--?\w[\w-]*)|([|>&;]|&&|\|\||>>|<<|2>&1)|(\S+)/g;

export function highlightShell(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let isFirst = true;

  SHELL_RE.lastIndex = 0;
  while ((match = SHELL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const [full, comment, str, variable, flag, op, word] = match;
    let cls = '';
    if (comment) cls = C.comment;
    else if (str) cls = C.str;
    else if (variable) cls = C.num;
    else if (flag) cls = C.flag;
    else if (op) cls = C.op;
    else if (word && isFirst) {
      cls = C.fn;
      isFirst = false;
    }

    if (full === '|' || full === '&&' || full === ';') isFirst = true;

    tokens.push(
      cls ? (
        <span key={match.index} className={cls}>
          {full}
        </span>
      ) : (
        full
      ),
    );
    lastIndex = SHELL_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

// ── Code highlighter (TS/JS/generic) ───────────────────────────

const CODE_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'import',
  'export',
  'from',
  'default',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'typeof',
  'instanceof',
  'interface',
  'type',
  'enum',
  'extends',
  'implements',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'this',
  'super',
  'def',
  'print',
  'self',
  'None',
  'True',
  'False',
  'elif',
  'lambda',
  'with',
  'as',
  'yield',
  'pass',
  'raise',
  'in',
  'not',
  'and',
  'or',
]);

const CODE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'object',
  'Array',
  'Map',
  'Set',
  'Promise',
  'Record',
  'Partial',
  'Required',
  'React',
  'ReactNode',
  'HTMLElement',
  'Event',
  'int',
  'float',
  'str',
  'list',
  'dict',
  'tuple',
  'set',
  'bool',
]);

const CODE_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b\w+\b)|([{}()[\];:,.<>=!+\-*/%&|^~?@])/g;

export function highlightCode(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CODE_RE.lastIndex = 0;
  while ((match = CODE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const [full, comment, str, num, word, punct] = match;
    let cls = '';
    if (comment) cls = C.comment;
    else if (str) cls = C.str;
    else if (num) cls = C.num;
    else if (word) {
      if (CODE_KEYWORDS.has(word)) cls = C.kw;
      else if (CODE_TYPES.has(word)) cls = C.type;
    } else if (punct) cls = C.punct;

    tokens.push(
      cls ? (
        <span key={match.index} className={cls}>
          {full}
        </span>
      ) : (
        full
      ),
    );
    lastIndex = CODE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

// ── Unified highlight function ─────────────────────────────────

export function highlight(text: string, lang: string): ReactNode[] {
  switch (lang) {
    case 'json':
      return highlightJSON(text);
    case 'shell':
      return highlightShell(text);
    case 'text':
      return [text];
    default:
      return highlightCode(text);
  }
}
