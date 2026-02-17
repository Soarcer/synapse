import { fmtTokens } from './constants';

interface TokenBreakdownBarProps {
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}

export function TokenBreakdownBar({
  cacheReadTokens,
  inputTokens,
  outputTokens,
  thinkingTokens,
}: TokenBreakdownBarProps) {
  const total = inputTokens + outputTokens;
  if (total === 0) return null;

  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">Token breakdown</div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
        {cacheReadTokens > 0 && (
          <div
            className="h-full"
            style={{
              width: `${(cacheReadTokens / total) * 100}%`,
              backgroundColor: '#8b5cf6',
            }}
            title={`Cached: ${fmtTokens(cacheReadTokens)}`}
          />
        )}
        <div
          className="h-full"
          style={{
            width: `${((inputTokens - cacheReadTokens) / total) * 100}%`,
            backgroundColor: '#3b82f6',
          }}
          title={`Fresh input: ${fmtTokens(inputTokens - cacheReadTokens)}`}
        />
        <div
          className="h-full"
          style={{
            width: `${(outputTokens / total) * 100}%`,
            backgroundColor: '#10b981',
          }}
          title={`Output: ${fmtTokens(outputTokens)}`}
        />
      </div>
      <div className="flex items-center gap-4 mt-1">
        <span className="text-[9px] text-purple-400 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-purple-500" /> cached {fmtTokens(cacheReadTokens)}
        </span>
        <span className="text-[9px] text-blue-400 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" /> input {fmtTokens(inputTokens - cacheReadTokens)}
        </span>
        <span className="text-[9px] text-emerald-400 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> output {fmtTokens(outputTokens)}
        </span>
        {thinkingTokens != null && thinkingTokens > 0 && (
          <span className="text-[9px] text-pink-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-pink-500" /> thinking {fmtTokens(thinkingTokens)}
          </span>
        )}
      </div>
    </div>
  );
}
