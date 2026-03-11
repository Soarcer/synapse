// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { ReactNode } from 'react';

/** Render inline markdown: **bold**, *italic*, `code` */
export function formatInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Match **bold**, *italic*, or `code` — non-greedy, no nesting
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2])
      parts.push(
        <strong key={key++} className="font-semibold text-gray-200">
          {match[2]}
        </strong>,
      );
    else if (match[3])
      parts.push(
        <em key={key++} className="italic text-gray-300">
          {match[3]}
        </em>,
      );
    else if (match[4])
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-gray-800 text-gray-300 text-xs font-mono"
        >
          {match[4]}
        </code>,
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Render plain text with line breaks, bullet lists, numbered lists, and inline markdown as formatted JSX */
export function formatRewrite(text: string): ReactNode {
  // Pre-process: split inline numbered patterns like "(1) ... (2) ..." or "; (1)" into separate lines
  const normalized = text
    .replace(/[;.]\s*\((\d+)\)\s*/g, '\n$1. ') // "; (2) text" → "\n2. text"
    .replace(/\((\d+)\)\s*/g, '\n$1. ') // "(1) text" → "\n1. text"
    .trim();
  const lines = normalized.split('\n');
  const elements: ReactNode[] = [];
  let listItems: { ordered: boolean; content: string }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const Tag = ordered ? 'ol' : 'ul';
    const cls = ordered ? 'list-decimal' : 'list-disc';
    elements.push(
      <Tag key={elements.length} className={`${cls} pl-5 my-1`}>
        {listItems.map((item, j) => (
          <li key={j}>{formatInline(item.content)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)/);

    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList();
      listItems.push({ ordered: false, content: bulletMatch[1] });
    } else if (orderedMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList();
      listItems.push({ ordered: true, content: orderedMatch[1] });
    } else {
      flushList();
      if (line.trim() === '') {
        elements.push(<div key={elements.length} className="h-2" />);
      } else {
        elements.push(
          <p key={elements.length} className="my-0.5">
            {formatInline(line)}
          </p>,
        );
      }
    }
  }
  flushList();
  return <>{elements}</>;
}
