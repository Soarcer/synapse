import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { highlight, highlightJSON, highlightShell, detectLang } from '../../utils/syntaxHighlight';
import { getToolIcon } from '../../utils/format';
import type { ToolCallSummary } from '../../types/agent';
import { useAgentStore } from '../../store/agentStore';

// ── Types ──────────────────────────────────────────────────────

export interface ToolRendererProps {
  input: Record<string, unknown> | undefined;
  response: Record<string, unknown> | undefined;
  status: 'running' | 'success' | 'error';
  toolName: string;
  toolUseId?: string;
}

// ── Shared Sub-Components ──────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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

function CollapsibleBlock({
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

function FilePath({ path, showCopy = true }: { path: string; showCopy?: boolean }) {
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

function CodeBlock({
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

function Badge({ children, color = 'gray' }: { children: ReactNode; color?: 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'cyan' }) {
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

function ErrorBanner({ error, context }: { error?: string; context?: string }) {
  if (!error && !context) return null;
  return (
    <div className="bg-red-950/50 border border-red-800/50 rounded px-3 py-2 text-xs">
      {error && <p className="text-red-300 font-medium">{error}</p>}
      {context && <p className="text-red-400/70 mt-1">{context}</p>}
    </div>
  );
}

function SizeIndicator({ text }: { text: string }) {
  return <Badge color="gray">{text}</Badge>;
}

function RunningIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-purple-400 py-2">
      <span className="animate-pulse">●</span>
      Running...
    </div>
  );
}

// ── Tool Summary Line ──────────────────────────────────────────

export function ToolSummaryLine({ tc }: { tc: ToolCallSummary }) {
  const icon = getToolIcon(tc.toolName);
  const summary = buildSummary(tc);
  return (
    <div className="flex items-start gap-2 text-xs text-gray-200 bg-gray-900/50 rounded px-2.5 py-2 border border-gray-800/50">
      <span className="text-sm shrink-0 mt-px">{icon}</span>
      <span className="break-all leading-relaxed">{summary}</span>
    </div>
  );
}

function buildSummary(tc: ToolCallSummary): string {
  const input = tc.toolInput;
  if (!input) return tc.toolName;

  switch (tc.toolName) {
    case 'Read': {
      const path = shortPath(input.file_path as string);
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      if (offset || limit) return `Read ${path} (lines ${offset ?? 1}–${(offset ?? 1) + (limit ?? 0)})`;
      return `Read ${path}`;
    }
    case 'Edit': {
      const path = shortPath(input.file_path as string);
      const oldStr = input.old_string as string | undefined;
      const lines = oldStr ? oldStr.split('\n').length : 0;
      const replaceAll = input.replace_all ? ' (all)' : '';
      return `Edit ${path} — ${lines} line${lines !== 1 ? 's' : ''} changed${replaceAll}`;
    }
    case 'Write': {
      const path = shortPath(input.file_path as string);
      return `Write ${path}`;
    }
    case 'Bash': {
      const desc = input.description as string | undefined;
      const cmd = input.command as string | undefined;
      if (desc) return `Run: ${desc}`;
      if (cmd) return `$ ${cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd}`;
      return 'Bash';
    }
    case 'Glob': {
      const pattern = input.pattern as string;
      const path = input.path as string | undefined;
      return `Find files: ${pattern}${path ? ` in ${shortPath(path)}` : ''}`;
    }
    case 'Grep': {
      const pattern = input.pattern as string;
      const path = input.path as string | undefined;
      const glob = input.glob as string | undefined;
      let suffix = '';
      if (path) suffix = ` in ${shortPath(path)}`;
      if (glob) suffix += ` (${glob})`;
      return `Search: "${pattern}"${suffix}`;
    }
    case 'WebSearch':
      return `Search: "${input.query as string}"`;
    case 'WebFetch': {
      const url = input.url as string;
      try { return `Fetch: ${new URL(url).hostname}`; } catch { return `Fetch: ${url?.slice(0, 50)}`; }
    }
    case 'Task': {
      const desc = input.description as string | undefined;
      const type = input.subagent_type as string | undefined;
      return `${type ?? 'Task'}: ${desc ?? (input.prompt as string)?.slice(0, 50) ?? 'agent task'}`;
    }
    case 'NotebookEdit': {
      const path = shortPath(input.notebook_path as string);
      const mode = input.edit_mode as string | undefined;
      return `Notebook ${mode ?? 'edit'}: ${path}`;
    }
    case 'AskUserQuestion': {
      const questions = input.questions as AskQuestion[] | undefined;
      if (!questions || questions.length === 0) return 'Ask user question';
      const headers = questions.map((q) => q.header).join(', ');
      return `Ask: ${headers} (${questions.length} question${questions.length !== 1 ? 's' : ''})`;
    }
    case 'TodoWrite': {
      const todos = input.todos as TodoItem[] | undefined;
      if (!todos || todos.length === 0) return 'Update task list';
      const done = todos.filter((t) => t.status === 'completed').length;
      const active = todos.filter((t) => t.status === 'in_progress').length;
      const parts: string[] = [];
      if (done > 0) parts.push(`${done} done`);
      if (active > 0) parts.push(`${active} active`);
      parts.push(`${todos.length} total`);
      return `Tasks: ${parts.join(', ')}`;
    }
    default:
      return tc.inputPreview ? `${tc.toolName}: ${tc.inputPreview}` : tc.toolName;
  }
}

function shortPath(path: string | undefined): string {
  if (!path) return '(unknown)';
  const normalized = String(path).replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return parts.slice(-3).join('/');
}

// ── Per-Tool Renderers ─────────────────────────────────────────

// 1. Read
function ReadRenderer({ input, response, status }: ToolRendererProps) {
  const filePath = input?.file_path as string | undefined;
  // Response structure: { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
  const file = response?.file as Record<string, unknown> | undefined;
  const content = (file?.content ?? response?.content) as string | undefined;
  const numLines = file?.numLines as number | undefined;
  const startLine = file?.startLine as number | undefined;
  const totalLines = file?.totalLines as number | undefined;
  const offset = input?.offset as number | undefined;
  const limit = input?.limit as number | undefined;
  const lang = filePath ? detectLang(filePath) : 'text';

  const isPartial = totalLines != null && numLines != null && numLines < totalLines;

  if (status === 'running') return <RunningIndicator />;

  // Build the line range badge
  let lineBadge: { label: string; color: 'gray' | 'amber' | 'blue' } | null = null;
  if (isPartial && startLine != null && numLines != null) {
    lineBadge = { label: `${startLine}–${startLine + numLines - 1} of ${totalLines}`, color: 'amber' };
  } else if (totalLines != null) {
    lineBadge = { label: `${totalLines} lines`, color: 'gray' };
  } else if (offset != null || limit != null) {
    lineBadge = { label: `Lines ${offset ?? 1}–${(offset ?? 1) + (limit ?? 0)}`, color: 'blue' };
  }

  return (
    <div className="space-y-2">
      {filePath && (
        <div className="flex items-start justify-between gap-2">
          <FilePath path={filePath} />
          {lineBadge && <Badge color={lineBadge.color}>{lineBadge.label}</Badge>}
        </div>
      )}

      {content ? (
        <CollapsibleBlock label="Content" count={`${numLines ?? content.split('\n').length} lines`} defaultOpen>
          <CodeBlock code={content} lang={lang} />
        </CollapsibleBlock>
      ) : response ? (
        <DefaultResponseBlock response={response} />
      ) : null}
    </div>
  );
}

// 2. Edit
function EditRenderer({ input, response, status }: ToolRendererProps) {
  const filePath = input?.file_path as string | undefined;
  const oldStr = input?.old_string as string | undefined;
  const newStr = input?.new_string as string | undefined;
  const replaceAll = input?.replace_all as boolean | undefined;
  const success = response?.success as boolean | undefined;

  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {filePath && <FilePath path={filePath} />}
        {replaceAll && <Badge color="amber">Replace All</Badge>}
      </div>

      {(oldStr != null || newStr != null) && (
        <CollapsibleBlock label="Changes" defaultOpen>
          <div className="bg-gray-950 rounded border border-gray-800 overflow-auto max-h-72 text-xs font-mono">
            {oldStr && oldStr.split('\n').map((line, i) => (
              <div key={`old-${i}`} className="bg-red-950/30 border-l-2 border-red-700/50 px-2 py-px">
                <span className="text-red-400/60 select-none mr-2">−</span>
                <span className="text-red-300/80">{line}</span>
              </div>
            ))}
            {newStr && newStr.split('\n').map((line, i) => (
              <div key={`new-${i}`} className="bg-green-950/30 border-l-2 border-green-700/50 px-2 py-px">
                <span className="text-green-400/60 select-none mr-2">+</span>
                <span className="text-green-300/80">{line}</span>
              </div>
            ))}
          </div>
        </CollapsibleBlock>
      )}

      {response && (
        <div className="flex items-center gap-2">
          {success === true && <Badge color="green">✓ Applied</Badge>}
          {success === false && <Badge color="red">✗ Failed</Badge>}
          {success == null && <DefaultResponseBlock response={response} />}
        </div>
      )}
    </div>
  );
}

// 3. Write
function WriteRenderer({ input, response, status }: ToolRendererProps) {
  const filePath = input?.file_path as string | undefined;
  const content = input?.content as string | undefined;
  const lang = filePath ? detectLang(filePath) : 'text';

  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {filePath && <FilePath path={filePath} />}
        <Badge color="blue">Write</Badge>
      </div>
      {content && (
        <CollapsibleBlock label="Content" count={`${content.split('\n').length} lines`} defaultOpen={content.split('\n').length <= 30}>
          <CodeBlock code={content} lang={lang} />
        </CollapsibleBlock>
      )}
      {response && <Badge color="green">✓ Written</Badge>}
    </div>
  );
}

// Strip ANSI escape codes from terminal output
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g, '');
}

// 4. Bash
function BashRenderer({ input, response, status }: ToolRendererProps) {
  const command = input?.command as string | undefined;
  const description = input?.description as string | undefined;
  const rawStdout = response?.stdout as string | undefined;
  const rawStderr = response?.stderr as string | undefined;
  const stdout = rawStdout ? stripAnsi(rawStdout) : undefined;
  const stderr = rawStderr ? stripAnsi(rawStderr) : undefined;
  const exitCode = (response?.exitCode ?? response?.exit_code) as number | undefined;

  return (
    <div className="space-y-2">
      {description && (
        <p className="text-xs text-gray-400 italic">{description}</p>
      )}

      {command && (
        <div className="bg-gray-950 rounded border border-gray-800 p-2 overflow-x-auto">
          <div className="flex items-start gap-2">
            <span className="text-green-500 select-none shrink-0 font-mono text-xs">$</span>
            <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap break-all flex-1">
              {highlightShell(command)}
            </pre>
            <CopyButton text={command} label="Copy command" />
          </div>
        </div>
      )}

      {status === 'running' ? (
        <RunningIndicator />
      ) : (
        <>
          {exitCode != null && (
            <div className="flex items-center gap-2">
              <Badge color={exitCode === 0 ? 'green' : 'red'}>
                exit {exitCode}
              </Badge>
              {stdout && <SizeIndicator text={`${stdout.split('\n').length} lines`} />}
            </div>
          )}

          {stdout && (
            <CollapsibleBlock label="stdout" count={`${stdout.split('\n').length} lines`} defaultOpen>
              <pre className="text-xs font-mono text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-60 whitespace-pre-wrap">
                {stdout}
              </pre>
            </CollapsibleBlock>
          )}

          {stderr && stderr.trim() && (
            <CollapsibleBlock label="stderr" count={`${stderr.split('\n').length} lines`} defaultOpen={false}>
              <pre className="text-xs font-mono text-red-300/80 bg-red-950/20 rounded border border-red-800/30 p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                {stderr}
              </pre>
            </CollapsibleBlock>
          )}
        </>
      )}
    </div>
  );
}

// 5. Glob
function GlobRenderer({ input, response, status }: ToolRendererProps) {
  const pattern = input?.pattern as string | undefined;
  const path = input?.path as string | undefined;
  const files = (response?.files ?? response?.result ?? (Array.isArray(response) ? response : null)) as string[] | null;

  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {pattern && <Badge color="cyan">{pattern}</Badge>}
        {path && <span className="text-xs text-gray-500">in {shortPath(path)}</span>}
      </div>

      {files && files.length > 0 ? (
        <CollapsibleBlock label="Files" count={`${files.length} matched`} defaultOpen>
          <FileList files={files} />
        </CollapsibleBlock>
      ) : files && files.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No files matched</p>
      ) : response ? (
        <DefaultResponseBlock response={response} />
      ) : null}
    </div>
  );
}

function FileList({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(files.length <= 20);
  const display = expanded ? files : files.slice(0, 15);
  return (
    <div className="bg-gray-950 rounded border border-gray-800 overflow-auto max-h-60">
      <div className="p-1.5 space-y-px">
        {display.map((f, i) => (
          <div key={i} className="text-xs font-mono text-gray-400 px-1.5 py-0.5 hover:bg-gray-900/50 rounded truncate">
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

// 6. Grep
function GrepRenderer({ input, response, status }: ToolRendererProps) {
  const pattern = input?.pattern as string | undefined;
  const path = input?.path as string | undefined;
  const glob = input?.glob as string | undefined;
  const outputMode = input?.output_mode as string | undefined;

  if (status === 'running') return <RunningIndicator />;

  // Try to extract results from various response shapes
  const files = response?.files as string[] | undefined;
  const content = response?.content as string | undefined;
  const result = response?.result as string | string[] | undefined;
  const count = response?.count as number | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {pattern && (
          <div className="flex items-center gap-1 bg-gray-900 rounded px-2 py-1 border border-gray-800">
            <span className="text-gray-600 text-[10px]">⌕</span>
            <span className="text-xs font-mono text-amber-300">{pattern}</span>
          </div>
        )}
        {path && <span className="text-xs text-gray-500">in {shortPath(path)}</span>}
        {glob && <Badge color="cyan">{glob}</Badge>}
      </div>

      {outputMode === 'count' && count != null && (
        <p className="text-xs text-gray-300">{count} matches</p>
      )}

      {files && files.length > 0 && (
        <CollapsibleBlock label="Files" count={`${files.length} files`} defaultOpen>
          <FileList files={files} />
        </CollapsibleBlock>
      )}

      {content && (
        <CollapsibleBlock label="Results" defaultOpen>
          <GrepContentBlock content={content} pattern={pattern} />
        </CollapsibleBlock>
      )}

      {typeof result === 'string' && (
        <CollapsibleBlock label="Results" defaultOpen>
          <GrepContentBlock content={result} pattern={pattern} />
        </CollapsibleBlock>
      )}

      {Array.isArray(result) && (
        <CollapsibleBlock label="Files" count={`${result.length} files`} defaultOpen>
          <FileList files={result} />
        </CollapsibleBlock>
      )}

      {!files && !content && !result && count == null && response && (
        <DefaultResponseBlock response={response} />
      )}
    </div>
  );
}

function GrepContentBlock({ content, pattern }: { content: string; pattern?: string }) {
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

function highlightMatch(line: string, pattern: string): ReactNode[] {
  try {
    const re = new RegExp(`(${pattern})`, 'gi');
    const parts = line.split(re);
    return parts.map((part, i) =>
      re.test(part) ? (
        <span key={i} className="bg-amber-900/40 text-amber-200 rounded-sm px-0.5">{part}</span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return [line];
  }
}

// 7. WebSearch
function WebSearchRenderer({ input, response, status }: ToolRendererProps) {
  const query = (input?.query ?? response?.query) as string | undefined;

  if (status === 'running') return <RunningIndicator />;

  // Claude Code WebSearch response structure:
  // { query, results: [ { tool_use_id, content: [{title, url}, ...] }, "summary text", ... ], durationSeconds }
  const rawResults = response?.results as unknown[] | undefined;
  const { links, summary } = parseWebSearchResults(rawResults);

  return (
    <div className="space-y-2">
      {query && (
        <div className="flex items-center gap-2 bg-gray-900 rounded-full px-3 py-1.5 border border-gray-700">
          <span className="text-gray-500 text-sm">🔍</span>
          <span className="text-xs text-gray-200 flex-1">{query}</span>
          <CopyButton text={query} label="Copy query" />
        </div>
      )}

      {summary && (
        <CollapsibleBlock label="Summary" defaultOpen>
          <pre className="text-xs text-gray-300 bg-gray-950 rounded border border-gray-800 p-2.5 overflow-auto max-h-60 whitespace-pre-wrap leading-relaxed">
            {summary}
          </pre>
        </CollapsibleBlock>
      )}

      {links.length > 0 && (
        <CollapsibleBlock label="Links" count={`${links.length} results`} defaultOpen>
          <div className="space-y-1">
            {links.map((link, i) => (
              <SearchResultCard key={i} title={link.title} url={link.url} />
            ))}
          </div>
        </CollapsibleBlock>
      )}

      {!links.length && !summary && response && (
        <DefaultResponseBlock response={response} />
      )}

      {response?.durationSeconds != null && (
        <span className="text-[10px] text-gray-600">
          {(response.durationSeconds as number).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function parseWebSearchResults(rawResults: unknown[] | undefined): {
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

function SearchResultCard({ title, url }: { title: string; url: string }) {
  let domain = '';
  try { domain = new URL(url).hostname; } catch { /* ignore */ }

  return (
    <div className="flex items-start gap-2 bg-gray-950 rounded border border-gray-800 px-2.5 py-1.5 text-xs hover:bg-gray-900/80 transition-colors">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 cursor-pointer"
        title={url}
      >
        <p className="text-blue-300 font-medium truncate hover:underline">{title || '(untitled)'}</p>
        {domain && <p className="text-green-400/60 text-[10px] truncate">{domain}</p>}
      </a>
      {url && <CopyButton text={url} label="Copy URL" />}
    </div>
  );
}

// 8. WebFetch
function WebFetchRenderer({ input, response, status }: ToolRendererProps) {
  const url = input?.url as string | undefined;
  const prompt = input?.prompt as string | undefined;
  const content = (response?.content ?? response?.result ?? response?.text) as string | undefined;

  let domain = '';
  try { if (url) domain = new URL(url).hostname; } catch { /* ignore */ }

  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      {url && (
        <div className="flex items-center gap-2 bg-gray-900 rounded px-2.5 py-1.5 border border-gray-800 min-w-0">
          <span className="text-green-500 text-[10px] shrink-0">🔒</span>
          {domain && <span className="text-xs text-green-400 shrink-0">{domain}</span>}
          <span className="text-xs text-gray-500 truncate flex-1">{url}</span>
          <CopyButton text={url} label="Copy URL" />
        </div>
      )}

      {prompt && (
        <div className="bg-blue-950/20 border border-blue-800/30 rounded px-2.5 py-2">
          <span className="text-gray-500 text-[10px] block mb-0.5">Prompt</span>
          <p className="text-xs text-gray-300">{prompt}</p>
        </div>
      )}

      {content ? (
        <CollapsibleBlock label="Response" count={`${String(content).split('\n').length} lines`} defaultOpen>
          <pre className="text-xs text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-60 whitespace-pre-wrap">
            {content}
          </pre>
        </CollapsibleBlock>
      ) : response ? (
        <DefaultResponseBlock response={response} />
      ) : null}
    </div>
  );
}

// 9. Task
function TaskRenderer({ input, response, status }: ToolRendererProps) {
  const subagentType = input?.subagent_type as string | undefined;
  const description = input?.description as string | undefined;
  const prompt = input?.prompt as string | undefined;
  const result = (response?.result ?? response?.content ?? response?.output) as string | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {subagentType && <Badge color="purple">{subagentType}</Badge>}
        {description && <span className="text-xs text-gray-300">{description}</span>}
      </div>

      {status === 'running' ? (
        <RunningIndicator />
      ) : (
        <>
          {prompt && (
            <CollapsibleBlock label="Prompt" count={`${prompt.split('\n').length} lines`} defaultOpen={prompt.split('\n').length <= 10}>
              <pre className="text-xs text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                {prompt}
              </pre>
            </CollapsibleBlock>
          )}

          {result ? (
            <CollapsibleBlock label="Result" count={`${String(result).split('\n').length} lines`} defaultOpen={String(result).split('\n').length <= 20}>
              <pre className="text-xs text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-60 whitespace-pre-wrap">
                {result}
              </pre>
            </CollapsibleBlock>
          ) : response ? (
            <DefaultResponseBlock response={response} />
          ) : null}
        </>
      )}
    </div>
  );
}

// 10. NotebookEdit
function NotebookEditRenderer({ input, response, status }: ToolRendererProps) {
  const notebookPath = input?.notebook_path as string | undefined;
  const cellNumber = input?.cell_number as number | undefined;
  const cellId = input?.cell_id as string | undefined;
  const cellType = input?.cell_type as string | undefined;
  const editMode = input?.edit_mode as string | undefined;
  const newSource = input?.new_source as string | undefined;

  const modeColors: Record<string, 'blue' | 'green' | 'red'> = {
    replace: 'blue',
    insert: 'green',
    delete: 'red',
  };

  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {notebookPath && <FilePath path={notebookPath} />}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {editMode && <Badge color={modeColors[editMode] ?? 'gray'}>{editMode}</Badge>}
        {cellNumber != null && <Badge color="gray">Cell {cellNumber}</Badge>}
        {cellId && <Badge color="gray">ID: {cellId.slice(0, 8)}</Badge>}
        {cellType && <Badge color="cyan">{cellType}</Badge>}
      </div>

      {newSource && (
        <CollapsibleBlock label="New Source" count={`${newSource.split('\n').length} lines`} defaultOpen>
          <CodeBlock
            code={newSource}
            lang={cellType === 'markdown' ? 'md' : 'py'}
          />
        </CollapsibleBlock>
      )}

      {response && <Badge color="green">✓ Applied</Badge>}
    </div>
  );
}

// 11. AskUserQuestion
interface AskQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

function AskUserQuestionRenderer({ input, response, status }: ToolRendererProps) {
  const questions = (input?.questions ?? response?.questions) as AskQuestion[] | undefined;
  const answers = (input?.answers ?? response?.answers) as Record<string, string> | undefined;
  const [activeTab, setActiveTab] = useState(0);

  if (status === 'running') return <RunningIndicator />;
  if (!questions || questions.length === 0) return <DefaultRenderer input={input} response={response} status={status} toolName="AskUserQuestion" />;

  const activeQ = questions[activeTab];
  const selectedAnswer = answers?.[activeQ.question];
  // For multiSelect, the answer is comma-separated labels
  const selectedLabels = selectedAnswer ? new Set(selectedAnswer.split(', ')) : new Set<string>();

  return (
    <div className="space-y-3">
      {/* Mockup preview */}
      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        {/* Tab bar */}
        {questions.length > 1 && (
          <div className="flex items-center gap-1 px-3 pt-2.5 pb-1 border-b border-gray-800 overflow-x-auto">
            {questions.map((q, i) => {
              const isActive = i === activeTab;
              const hasAnswer = answers?.[q.question] != null;
              return (
                <button
                  key={i}
                  onClick={(e) => {
                    setActiveTab(i);
                    (e.currentTarget as HTMLElement).scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
                  }}
                  className={`
                    px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider shrink-0 transition-colors
                    ${isActive
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                      : hasAnswer
                        ? 'bg-green-900/20 text-green-400/70 border border-green-700/30 hover:bg-green-900/30'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'}
                  `}
                >
                  {hasAnswer && <span className="mr-1">✓</span>}
                  {q.header}
                </button>
              );
            })}
          </div>
        )}

        {/* Question content */}
        <div className="p-3">
          {/* Question text */}
          <p className="text-xs text-gray-200 font-medium mb-3">{activeQ.question}</p>

          {/* Options */}
          <div className="space-y-1.5">
            {activeQ.options.map((opt, i) => {
              const isSelected = selectedLabels.has(opt.label);
              const hasAnyAnswer = selectedLabels.size > 0;
              const isDimmed = hasAnyAnswer && !isSelected;

              return (
                <div
                  key={i}
                  className={`
                    flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-colors
                    ${isSelected
                      ? 'bg-green-950/30 border-green-600/40'
                      : isDimmed
                        ? 'bg-gray-950/30 border-gray-800/50 opacity-50'
                        : 'bg-gray-950/50 border-gray-800'}
                  `}
                >
                  {/* Radio/checkbox indicator */}
                  <div className="mt-0.5 shrink-0">
                    {activeQ.multiSelect ? (
                      <div className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center ${
                        isSelected ? 'border-green-500 bg-green-600' : 'border-gray-600'
                      }`}>
                        {isSelected && <span className="text-white text-[8px] font-bold">✓</span>}
                      </div>
                    ) : (
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-green-500' : 'border-gray-600'
                      }`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      </div>
                    )}
                  </div>

                  {/* Label + description */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium ${isSelected ? 'text-green-300' : 'text-gray-200'}`}>
                      {opt.label}
                    </p>
                    {opt.description && (
                      <p className={`text-[10px] leading-relaxed mt-0.5 ${isSelected ? 'text-green-400/60' : 'text-gray-500'}`}>
                        {opt.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* "Other" option (always present in real UI) */}
          <div className="flex items-start gap-2.5 rounded-lg px-3 py-2 border bg-gray-950/30 border-gray-800/50 opacity-40 mt-1.5">
            <div className="mt-0.5 shrink-0">
              {activeQ.multiSelect ? (
                <div className="w-3.5 h-3.5 rounded-sm border-2 border-gray-600" />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-600" />
              )}
            </div>
            <p className="text-xs text-gray-600 italic">Other...</p>
          </div>

          {/* Answer indicator */}
          {selectedAnswer && (
            <div className="mt-3 pt-2 border-t border-gray-800 flex items-center gap-2">
              <span className="text-green-500 text-[10px]">✓</span>
              <span className="text-[10px] text-gray-400">Selected:</span>
              <span className="text-[10px] text-green-300 font-medium">{selectedAnswer}</span>
            </div>
          )}
        </div>
      </div>

      {/* Raw input — always visible */}
      <CollapsibleBlock label="Raw Input" count={`${JSON.stringify(input ?? {}).length} bytes`} defaultOpen={false}>
        <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
          {highlightJSON(JSON.stringify(input, null, 2))}
        </pre>
      </CollapsibleBlock>
    </div>
  );
}

// 12. TodoWrite
interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

type TodoChange = 'new' | 'completed' | 'started' | 'reverted' | 'unchanged';

function TodoWriteRenderer({ input, status, toolUseId }: ToolRendererProps) {
  const agents = useAgentStore((s) => s.agents);
  const toolAgentMap = useAgentStore((s) => s.toolAgentMap);

  if (status === 'running') return <RunningIndicator />;

  const todos = (input?.todos as TodoItem[] | undefined) ?? [];

  // Find previous TodoWrite call from same agent to diff against
  const prevTodos = useMemo(() => {
    if (!toolUseId) return null;
    const agentId = toolAgentMap.get(toolUseId);
    if (!agentId) return null;
    const agent = agents.get(agentId);
    if (!agent) return null;

    const toolCalls = agent.toolCalls;
    const currentIdx = toolCalls.findIndex((tc) => tc.toolUseId === toolUseId);
    if (currentIdx <= 0) return null;

    // Walk backwards to find previous TodoWrite
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (toolCalls[i].toolName === 'TodoWrite') {
        return (toolCalls[i].toolInput?.todos as TodoItem[] | undefined) ?? null;
      }
    }
    return null;
  }, [toolUseId, toolAgentMap, agents]);

  // Build prev map: content → status
  const prevMap = useMemo(() => {
    if (!prevTodos) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const t of prevTodos) m.set(t.content, t.status);
    return m;
  }, [prevTodos]);

  // Classify each item's change type
  const items = useMemo(() => {
    return todos.map((todo) => {
      const prevStatus = prevMap.get(todo.content);
      let change: TodoChange;
      if (prevStatus == null) {
        change = 'new';
      } else if (prevStatus === todo.status) {
        change = 'unchanged';
      } else if (todo.status === 'completed') {
        change = 'completed';
      } else if (todo.status === 'in_progress') {
        change = 'started';
      } else if (todo.status === 'pending' && prevStatus !== 'pending') {
        change = 'reverted';
      } else {
        change = 'unchanged';
      }
      return { ...todo, change };
    });
  }, [todos, prevMap]);

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const pending = todos.filter((t) => t.status === 'pending').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const hasPrev = prevTodos != null;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {total > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-gray-400">
              {completed}/{total} completed
            </span>
            <span className="text-gray-500">{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
            {completed > 0 && (
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            )}
            {inProgress > 0 && (
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${(inProgress / total) * 100}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[9px] text-gray-500">
            {completed > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                {completed} done
              </span>
            )}
            {inProgress > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                {inProgress} active
              </span>
            )}
            {pending > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-600 inline-block" />
                {pending} pending
              </span>
            )}
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="space-y-1">
        {items.map((item, i) => {
          const isNewlyCompleted = hasPrev && item.change === 'completed';
          const isNewlyStarted = hasPrev && item.change === 'started';
          const isNew = hasPrev && item.change === 'new';
          const isReverted = hasPrev && item.change === 'reverted';

          return (
            <div
              key={i}
              className={`
                flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-colors
                ${isNewlyCompleted
                  ? 'bg-green-950/30 border-green-600/40 shadow-md shadow-green-500/10'
                  : isNewlyStarted
                    ? 'bg-purple-950/30 border-purple-600/40'
                    : isNew
                      ? 'bg-blue-950/20 border-blue-700/30'
                      : isReverted
                        ? 'bg-amber-950/20 border-amber-700/30'
                        : item.status === 'completed'
                          ? 'bg-gray-900/30 border-gray-800/50'
                          : item.status === 'in_progress'
                            ? 'bg-gray-900/50 border-gray-700'
                            : 'bg-gray-950/30 border-gray-800'}
              `}
            >
              {/* Status indicator */}
              <div className="mt-0.5 shrink-0">
                {item.status === 'completed' ? (
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center ${
                      isNewlyCompleted
                        ? 'bg-green-600 border border-green-500'
                        : 'bg-green-800/50 border border-green-700/50'
                    }`}
                  >
                    <span className="text-white text-[9px] font-bold">✓</span>
                  </div>
                ) : item.status === 'in_progress' ? (
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      isNewlyStarted ? 'border-purple-400 animate-pulse' : 'border-purple-500'
                    }`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded border-2 border-gray-600" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className={`text-xs leading-relaxed ${
                      item.status === 'completed'
                        ? isNewlyCompleted
                          ? 'text-green-300 font-medium'
                          : 'text-gray-500 line-through'
                        : item.status === 'in_progress'
                          ? 'text-gray-200'
                          : 'text-gray-400'
                    }`}
                  >
                    {item.status === 'in_progress' ? item.activeForm : item.content}
                  </p>
                  {/* Change badges */}
                  {isNew && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-800/50 text-blue-300 font-semibold uppercase shrink-0">
                      New
                    </span>
                  )}
                  {isReverted && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-800/50 text-amber-300 font-semibold uppercase shrink-0">
                      Reverted
                    </span>
                  )}
                </div>
                {/* Show content below activeForm for in_progress items */}
                {item.status === 'in_progress' && item.activeForm !== item.content && (
                  <p className="text-[10px] text-gray-600 mt-0.5">{item.content}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Diff indicator */}
      {hasPrev && (
        <p className="text-[9px] text-gray-600 italic">
          Compared with previous snapshot
        </p>
      )}

      {/* Raw JSON */}
      <CollapsibleBlock label="Raw Input" count={`${JSON.stringify(input ?? {}).length} bytes`} defaultOpen>
        <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
          {highlightJSON(JSON.stringify(input, null, 2))}
        </pre>
      </CollapsibleBlock>
    </div>
  );
}

// Default fallback
function DefaultRenderer({ input, response, status }: ToolRendererProps) {
  if (status === 'running') return <RunningIndicator />;

  return (
    <div className="space-y-2">
      {input && (
        <CollapsibleBlock label="Input" count={`${JSON.stringify(input).length} bytes`} defaultOpen>
          <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
            {highlightJSON(JSON.stringify(input, null, 2))}
          </pre>
        </CollapsibleBlock>
      )}
      {response && (
        <CollapsibleBlock label="Response" count={`${JSON.stringify(response).length} bytes`} defaultOpen={JSON.stringify(response).length < 500}>
          <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
            {highlightJSON(JSON.stringify(response, null, 2))}
          </pre>
        </CollapsibleBlock>
      )}
    </div>
  );
}

function DefaultResponseBlock({ response }: { response: Record<string, unknown> }) {
  const json = JSON.stringify(response, null, 2);
  return (
    <CollapsibleBlock label="Response" count={`${json.length} bytes`} defaultOpen={json.length < 500}>
      <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
        {highlightJSON(json)}
      </pre>
    </CollapsibleBlock>
  );
}

// ── Renderer Dispatch ──────────────────────────────────────────

const TOOL_RENDERERS: Record<string, React.FC<ToolRendererProps>> = {
  Read: ReadRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  Bash: BashRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  WebSearch: WebSearchRenderer,
  WebFetch: WebFetchRenderer,
  Task: TaskRenderer,
  NotebookEdit: NotebookEditRenderer,
  AskUserQuestion: AskUserQuestionRenderer,
  TodoWrite: TodoWriteRenderer,
};

export function ToolRenderer({ input, response, status, toolName, toolUseId }: ToolRendererProps) {
  const Renderer = TOOL_RENDERERS[toolName] ?? DefaultRenderer;

  // Error banner for failed tools
  const errorMsg = status === 'error' ? extractError(input, response, toolName) : null;

  return (
    <div className="space-y-2">
      {errorMsg && <ErrorBanner error={errorMsg.error} context={errorMsg.context} />}
      <Renderer input={input} response={response} status={status} toolName={toolName} toolUseId={toolUseId} />
    </div>
  );
}

function extractError(
  input: Record<string, unknown> | undefined,
  response: Record<string, unknown> | undefined,
  toolName: string,
): { error?: string; context?: string } | null {
  const error = (response?.error ?? response?.message ?? input?.error) as string | undefined;
  if (!error) return null;

  let context: string | undefined;
  switch (toolName) {
    case 'Read':
    case 'Write':
      context = input?.file_path ? `Path: ${input.file_path}` : undefined;
      break;
    case 'Edit':
      context = input?.file_path ? `File: ${input.file_path}` : undefined;
      break;
    case 'Bash':
      context = input?.command ? `Command: ${String(input.command).slice(0, 80)}` : undefined;
      break;
  }

  return { error, context };
}

