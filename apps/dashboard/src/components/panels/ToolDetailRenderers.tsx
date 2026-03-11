// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useMemo } from 'react';
import { highlightJSON, highlightShell, detectLang } from '../../utils/syntaxHighlight';
import { useAgentStore } from '../../store/agentStore';
import {
  CopyButton,
  CollapsibleBlock,
  FilePath,
  CodeBlock,
  Badge,
  ErrorBanner,
  SizeIndicator,
  RunningIndicator,
  DefaultResponseBlock,
  FileList,
  GrepContentBlock,
  SearchResultCard,
  parseWebSearchResults,
  stripAnsi,
  shortPath,
} from './renderers/shared';
import { ToolSummaryLine, type AskQuestion, type TodoItem } from './renderers/ToolSummary';

// ── Re-exports ─────────────────────────────────────────────────

export { ToolSummaryLine };

// ── Types ──────────────────────────────────────────────────────

export interface ToolRendererProps {
  input: Record<string, unknown> | undefined;
  response: Record<string, unknown> | undefined;
  status: 'running' | 'success' | 'error';
  toolName: string;
  toolUseId?: string;
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
    lineBadge = {
      label: `${startLine}–${startLine + numLines - 1} of ${totalLines}`,
      color: 'amber',
    };
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
        <CollapsibleBlock
          label="Content"
          count={`${numLines ?? content.split('\n').length} lines`}
          defaultOpen
        >
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
            {oldStr &&
              oldStr.split('\n').map((line, i) => (
                <div
                  key={`old-${i}`}
                  className="bg-red-950/30 border-l-2 border-red-700/50 px-2 py-px"
                >
                  <span className="text-red-400/60 select-none mr-2">−</span>
                  <span className="text-red-300/80">{line}</span>
                </div>
              ))}
            {newStr &&
              newStr.split('\n').map((line, i) => (
                <div
                  key={`new-${i}`}
                  className="bg-green-950/30 border-l-2 border-green-700/50 px-2 py-px"
                >
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
        <CollapsibleBlock
          label="Content"
          count={`${content.split('\n').length} lines`}
          defaultOpen={content.split('\n').length <= 30}
        >
          <CodeBlock code={content} lang={lang} />
        </CollapsibleBlock>
      )}
      {response && <Badge color="green">✓ Written</Badge>}
    </div>
  );
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
      {description && <p className="text-xs text-gray-400 italic">{description}</p>}

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
              <Badge color={exitCode === 0 ? 'green' : 'red'}>exit {exitCode}</Badge>
              {stdout && <SizeIndicator text={`${stdout.split('\n').length} lines`} />}
            </div>
          )}

          {stdout && (
            <CollapsibleBlock
              label="stdout"
              count={`${stdout.split('\n').length} lines`}
              defaultOpen
            >
              <pre className="text-xs font-mono text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-60 whitespace-pre-wrap">
                {stdout}
              </pre>
            </CollapsibleBlock>
          )}

          {stderr && stderr.trim() && (
            <CollapsibleBlock
              label="stderr"
              count={`${stderr.split('\n').length} lines`}
              defaultOpen={false}
            >
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
  const files = (response?.files ??
    response?.result ??
    (Array.isArray(response) ? response : null)) as string[] | null;

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

      {!links.length && !summary && response && <DefaultResponseBlock response={response} />}

      {response?.durationSeconds != null && (
        <span className="text-[10px] text-gray-600">
          {(response.durationSeconds as number).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

// 8. WebFetch
function WebFetchRenderer({ input, response, status }: ToolRendererProps) {
  const url = input?.url as string | undefined;
  const prompt = input?.prompt as string | undefined;
  const content = (response?.content ?? response?.result ?? response?.text) as string | undefined;

  let domain = '';
  try {
    if (url) domain = new URL(url).hostname;
  } catch {
    /* ignore */
  }

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
        <CollapsibleBlock
          label="Response"
          count={`${String(content).split('\n').length} lines`}
          defaultOpen
        >
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
  const rawResult = response?.result ?? response?.content ?? response?.output;
  // Claude Code returns content blocks: [{type:"text", text:"..."}] — extract the text
  const result: string | undefined =
    typeof rawResult === 'string'
      ? rawResult
      : Array.isArray(rawResult)
        ? rawResult
            .map((b: unknown) =>
              b && typeof b === 'object' && 'text' in b ? (b as { text: string }).text : String(b),
            )
            .join('\n')
        : rawResult != null
          ? String(rawResult)
          : undefined;

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
            <CollapsibleBlock
              label="Prompt"
              count={`${prompt.split('\n').length} lines`}
              defaultOpen={prompt.split('\n').length <= 10}
            >
              <pre className="text-xs text-gray-300 bg-gray-950 rounded border border-gray-800 p-2 overflow-auto max-h-40 whitespace-pre-wrap font-mono">
                {prompt}
              </pre>
            </CollapsibleBlock>
          )}

          {result ? (
            <CollapsibleBlock
              label="Result"
              count={`${String(result).split('\n').length} lines`}
              defaultOpen={String(result).split('\n').length <= 20}
            >
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
        <CollapsibleBlock
          label="New Source"
          count={`${newSource.split('\n').length} lines`}
          defaultOpen
        >
          <CodeBlock code={newSource} lang={cellType === 'markdown' ? 'md' : 'py'} />
        </CollapsibleBlock>
      )}

      {response && <Badge color="green">✓ Applied</Badge>}
    </div>
  );
}

// 11. AskUserQuestion
function AskUserQuestionRenderer({ input, response, status }: ToolRendererProps) {
  const questions = (input?.questions ?? response?.questions) as AskQuestion[] | undefined;
  const answers = (input?.answers ?? response?.answers) as Record<string, string> | undefined;
  const [activeTab, setActiveTab] = useState(0);

  if (status === 'running') return <RunningIndicator />;
  if (!questions || questions.length === 0)
    return (
      <DefaultRenderer
        input={input}
        response={response}
        status={status}
        toolName="AskUserQuestion"
      />
    );

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
                    (e.currentTarget as HTMLElement).scrollIntoView({
                      inline: 'center',
                      behavior: 'smooth',
                      block: 'nearest',
                    });
                  }}
                  className={`
                    px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider shrink-0 transition-colors
                    ${
                      isActive
                        ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                        : hasAnswer
                          ? 'bg-green-900/20 text-green-400/70 border border-green-700/30 hover:bg-green-900/30'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
                    }
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
                    ${
                      isSelected
                        ? 'bg-green-950/30 border-green-600/40'
                        : isDimmed
                          ? 'bg-gray-950/30 border-gray-800/50 opacity-50'
                          : 'bg-gray-950/50 border-gray-800'
                    }
                  `}
                >
                  {/* Radio/checkbox indicator */}
                  <div className="mt-0.5 shrink-0">
                    {activeQ.multiSelect ? (
                      <div
                        className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center ${
                          isSelected ? 'border-green-500 bg-green-600' : 'border-gray-600'
                        }`}
                      >
                        {isSelected && <span className="text-white text-[8px] font-bold">✓</span>}
                      </div>
                    ) : (
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-green-500' : 'border-gray-600'
                        }`}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      </div>
                    )}
                  </div>

                  {/* Label + description */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-medium ${isSelected ? 'text-green-300' : 'text-gray-200'}`}
                    >
                      {opt.label}
                    </p>
                    {opt.description && (
                      <p
                        className={`text-[10px] leading-relaxed mt-0.5 ${isSelected ? 'text-green-400/60' : 'text-gray-500'}`}
                      >
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
      <CollapsibleBlock
        label="Raw Input"
        count={`${JSON.stringify(input ?? {}).length} bytes`}
        defaultOpen={false}
      >
        <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
          {highlightJSON(JSON.stringify(input, null, 2))}
        </pre>
      </CollapsibleBlock>
    </div>
  );
}

// 12. TodoWrite
type TodoChange = 'new' | 'completed' | 'started' | 'reverted' | 'unchanged';

function TodoWriteRenderer({ input, status, toolUseId }: ToolRendererProps) {
  const agents = useAgentStore((s) => s.agents);
  const toolAgentMap = useAgentStore((s) => s.toolAgentMap);

  const todos = useMemo(() => (input?.todos as TodoItem[] | undefined) ?? [], [input?.todos]);

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

  if (status === 'running') return <RunningIndicator />;

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
                ${
                  isNewlyCompleted
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
                              : 'bg-gray-950/30 border-gray-800'
                }
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
        <p className="text-[9px] text-gray-600 italic">Compared with previous snapshot</p>
      )}

      {/* Raw JSON */}
      <CollapsibleBlock
        label="Raw Input"
        count={`${JSON.stringify(input ?? {}).length} bytes`}
        defaultOpen
      >
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
        <CollapsibleBlock
          label="Response"
          count={`${JSON.stringify(response).length} bytes`}
          defaultOpen={JSON.stringify(response).length < 500}
        >
          <pre className="text-xs bg-gray-950 rounded border border-gray-800 p-2 text-gray-300 overflow-auto max-h-52 font-mono whitespace-pre-wrap">
            {highlightJSON(JSON.stringify(response, null, 2))}
          </pre>
        </CollapsibleBlock>
      )}
    </div>
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
      <Renderer
        input={input}
        response={response}
        status={status}
        toolName={toolName}
        toolUseId={toolUseId}
      />
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
