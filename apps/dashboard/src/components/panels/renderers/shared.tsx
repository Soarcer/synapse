// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useCallback, type ReactNode } from 'react';
import { highlight, highlightJSON } from '../../../utils/syntaxHighlight';
import { copyToClipboard } from '../../../utils/clipboard';

// ── Utility Functions ───────────────────────────────────────────

/** Strip ANSI escape codes from terminal output */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g, '');
}

/** Shorten a file path to the last 3 segments */
export function shortPath(path: string | undefined): string {
  if (!path) return '(unknown)';
  const normalized = String(path).replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return parts.slice(-3).join('/');
}

// ── Shared Sub-Components ───────────────────────────────────────

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title={label ?? 'Copy'}
      className="text-gray-600 hover:text-gray-300 text-[10px] px-1 py-0.5 rounded hover:bg-gray-800 transition-colors shrink-0"
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export function CollapsibleBlock({
  label,
  count,
  defaultOpen = true,
  children,
}: {
  label: string;
  count?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-gray-500 text-xs hover:text-gray-300 transition-colors w-full"
      >
        <span className="text-[10px]">{open ? '▾' : '▸'}</span>
        <span>{label}</span>
        {count && <span className="text-gray-600 ml-auto">{count}</span>}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function FilePath({ path, showCopy = true }: { path: string; showCopy?: boolean }) {
  const normalized = String(path).replace(/\\/g, '/');
  const parts = normalized.split('/');
  const filename = parts[parts.length - 1] || normalized;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-blue-300 font-medium truncate">{filename}</span>
        {showCopy && <CopyButton text={normalized} label="Copy path" />}
      </div>
      {parts.length > 1 && (
        <p className="text-[10px] text-gray-600 font-mono truncate mt-0.5" title={normalized}>
          {normalized}
        </p>
      )}
    </div>
  );
}

export function CodeBlock({
  code,
  lang = 'text',
  maxLines = 30,
  showLineNumbers = true,
}: {
  code: string;
  lang?: string;
  maxLines?: number;
  showLineNumbers?: boolean;
}) {
  const lines = code.split('\n');
  const [expanded, setExpanded] = useState(lines.length <= maxLines);
  const displayLines = expanded ? lines : lines.slice(0, maxLines - 5);

  return (
    <div className="relative">
      <div className="bg-gray-950 rounded border border-gray-800 overflow-auto max-h-72 text-xs font-mono">
        <table className="w-full border-collapse">
          <tbody>
            {displayLines.map((line, i) => (
              <tr key={i} className="hover:bg-gray-900/50">
                {showLineNumbers && (
                  <td className="text-gray-700 text-right pr-2 pl-2 select-none w-8 align-top">
                    {i + 1}
                  </td>
                )}
                <td className="text-gray-300 pr-2 whitespace-pre-wrap break-all">
                  {highlight(line, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full py-1.5 text-[10px] text-blue-400 hover:text-blue-300 bg-gray-900/80 border-t border-gray-800 transition-colors"
          >
            Show all ({lines.length} lines)
          </button>
        )}
      </div>
      <div className="absolute top-1 right-1">
        <CopyButton text={code} label="Copy content" />
      </div>
    </div>
  );
}

export function Badge({
  children,
  color = 'gray',
}: {
  children: ReactNode;
  color?: 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'cyan';
}) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-800 text-gray-400',
    green: 'bg-green-900/50 text-green-300',
    red: 'bg-red-900/50 text-red-300',
    blue: 'bg-blue-900/50 text-blue-300',
    amber: 'bg-amber-900/50 text-amber-300',
    purple: 'bg-purple-900/50 text-purple-300',
    cyan: 'bg-cyan-900/50 text-cyan-300',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded whitespace-nowrap ${colors[color]}`}>
      {children}
    </span>
  );
}

export function ErrorBanner({ error, context }: { error?: string; context?: string }) {
  if (!error && !context) return null;
  return (
    <div className="bg-red-950/50 border border-red-800/50 rounded px-3 py-2 text-xs">
      {error && <p className="text-red-300 font-medium">{error}</p>}
      {context && <p className="text-red-400/70 mt-1">{context}</p>}
    </div>
  );
}

export function SizeIndicator({ text }: { text: string }) {
  return <Badge color="gray">{text}</Badge>;
}

export function RunningIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-purple-400 py-2">
      <span className="animate-pulse">●</span>
      Running...
    </div>
  );
}

export function DefaultResponseBlock({ response }: { response: Record<string, unknown> }) {
  const json = JSON.stringify(response, null, 2);
  return (
    <CollapsibleBlock
      label="Response"
      count={`${json.length} bytes`}
      defaultOpen={json.length < 500}
    >
      <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
        {highlightJSON(json)}
      </pre>
    </CollapsibleBlock>
  );
}

export function FileList({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(files.length <= 20);
  const display = expanded ? files : files.slice(0, 15);
  return (
    <div className="bg-gray-950 rounded border border-gray-800 overflow-auto max-h-60">
      <div className="p-1.5 space-y-px">
        {display.map((f, i) => (
          <div
            key={i}
            className="text-xs font-mono text-gray-400 px-1.5 py-0.5 hover:bg-gray-900/50 rounded truncate"
          >
            {String(f).replace(/\\/g, '/')}
          </div>
        ))}
      </div>
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-1.5 text-[10px] text-blue-400 hover:text-blue-300 bg-gray-900/80 border-t border-gray-800 transition-colors"
        >
          Show all ({files.length} files)
        </button>
      )}
    </div>
  );
}

// ── Grep / Search Helpers ───────────────────────────────────────

export function GrepContentBlock({ content, pattern }: { content: string; pattern?: string }) {
  const lines = content.split('\n').slice(0, 200);
  return (
    <pre className="text-xs font-mono bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-60 whitespace-pre-wrap text-gray-400">
      {lines.map((line, i) => (
        <div key={i}>
          {pattern ? highlightMatch(line, pattern) : line}
          {'\n'}
        </div>
      ))}
    </pre>
  );
}

export function highlightMatch(line: string, pattern: string): ReactNode[] {
  try {
    const re = new RegExp(`(${pattern})`, 'gi');
    const parts = line.split(re);
    return parts.map((part, i) =>
      re.test(part) ? (
        <span key={i} className="bg-amber-900/40 text-amber-200 rounded-sm px-0.5">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  } catch {
    return [line];
  }
}

export function SearchResultCard({ title, url }: { title: string; url: string }) {
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    /* ignore */
  }

  return (
    <div className="flex items-start gap-2 bg-gray-950 rounded border border-gray-800 px-2.5 py-1.5 text-xs hover:bg-gray-900/80 transition-colors">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 cursor-pointer"
        title={url}
      >
        <p className="text-blue-300 font-medium truncate hover:underline">
          {title || '(untitled)'}
        </p>
        {domain && <p className="text-green-400/60 text-[10px] truncate">{domain}</p>}
      </a>
      {url && <CopyButton text={url} label="Copy URL" />}
    </div>
  );
}

export function parseWebSearchResults(rawResults: unknown[] | undefined): {
  links: Array<{ title: string; url: string }>;
  summary: string;
} {
  const links: Array<{ title: string; url: string }> = [];
  let summary = '';

  if (!rawResults) return { links, summary };

  for (const item of rawResults) {
    if (typeof item === 'string') {
      // Summary text
      summary += (summary ? '\n\n' : '') + item;
    } else if (item && typeof item === 'object' && 'content' in item) {
      // Object with content array of {title, url}
      const content = (item as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const entry of content) {
          if (entry && typeof entry === 'object' && 'title' in entry) {
            links.push({
              title: String((entry as Record<string, unknown>).title ?? ''),
              url: String((entry as Record<string, unknown>).url ?? ''),
            });
          }
        }
      }
    }
  }

  return { links, summary };
}
