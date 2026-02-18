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
  // inputTokens is already fresh (does NOT include cacheReadTokens)
  const freshInput = Math.max(0, inputTokens);
  const thinking = thinkingTokens ?? 0;
  const barTotal = freshInput + outputTokens + thinking;
  if (barTotal === 0 && cacheReadTokens === 0) return null;

  return (
    <div>
      {/* Label + counts on one row */}
      <div className="flex items-center justify-center gap-3 mb-1.5">
        <span className="text-xs text-gray-500">Token breakdown</span>
        {cacheReadTokens > 0 && (
          <span className="text-[11px] text-purple-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-purple-500" /> cached {fmtTokens(cacheReadTokens)}
          </span>
        )}
        <span className="text-[11px] text-blue-400 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" /> input {fmtTokens(freshInput)}
        </span>
        <span className="text-[11px] text-emerald-400 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> output {fmtTokens(outputTokens)}
        </span>
        {thinking > 0 && (
          <span className="text-[11px] text-pink-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-pink-500" /> thinking {fmtTokens(thinking)}
          </span>
        )}
      </div>

      {/* Bar */}
      {barTotal > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
          {freshInput > 0 && (
            <div
              className="h-full"
              style={{
                width: `${(freshInput / barTotal) * 100}%`,
                backgroundColor: '#3b82f6',
              }}
              title={`Input: ${fmtTokens(freshInput)}`}
            />
          )}
          {outputTokens > 0 && (
            <div
              className="h-full"
              style={{
                width: `${(outputTokens / barTotal) * 100}%`,
                backgroundColor: '#10b981',
              }}
              title={`Output: ${fmtTokens(outputTokens)}`}
            />
          )}
          {thinking > 0 && (
            <div
              className="h-full"
              style={{
                width: `${(thinking / barTotal) * 100}%`,
                backgroundColor: '#ec4899',
              }}
              title={`Thinking: ${fmtTokens(thinking)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
