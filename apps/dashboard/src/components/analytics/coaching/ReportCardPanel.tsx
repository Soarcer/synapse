import { useState, useCallback } from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import type { ReportCard, DimensionScore, DetectorResult } from '@synapse-ai/core';
import { InfoTooltip } from '../shared/InfoTooltip';

interface ReportCardPanelProps {
  reportCard: ReportCard | null;
  isLoading: boolean;
}

// ─── Grade Colors ────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-emerald-400';
  if (grade.startsWith('B')) return 'text-blue-400';
  if (grade.startsWith('C')) return 'text-amber-400';
  if (grade.startsWith('D')) return 'text-orange-400';
  return 'text-red-400';
}

function gradeBg(grade: string): string {
  if (grade.startsWith('A')) return 'bg-emerald-500/10 border-emerald-500/30';
  if (grade.startsWith('B')) return 'bg-blue-500/10 border-blue-500/30';
  if (grade.startsWith('C')) return 'bg-amber-500/10 border-amber-500/30';
  if (grade.startsWith('D')) return 'bg-orange-500/10 border-orange-500/30';
  return 'bg-red-500/10 border-red-500/30';
}

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// ─── Dimension Labels (short) ────────────────────────────────────────

const SHORT_LABELS: Record<string, string> = {
  'Planning & Preparation': 'Planning',
  'Prompt Precision': 'Precision',
  'Tool Craft': 'Tools',
  'Context Management': 'Context',
  'Cost Efficiency': 'Cost',
  'Verification & Quality': 'Verify',
  'Session Strategy': 'Strategy',
  'Configuration': 'Config',
};

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  'Planning & Preparation': 'How well you read and understand code before making changes. Measures read-before-edit ratio, context front-loading, and prompt specificity.',
  'Prompt Precision': 'Quality and clarity of your prompts. Checks for single-concern prompts, file references, verification instructions, and clear success criteria.',
  'Tool Craft': 'Effective use of Claude\'s tools. Measures dedicated tool usage over Bash, Edit over Write, subagent delegation, and error rates.',
  'Context Management': 'How efficiently you manage the context window. Tracks compaction avoidance, file re-reads, scope focus, and context utilization.',
  'Cost Efficiency': 'Spending optimization across models and tokens. Evaluates model matching to task complexity, cache utilization, and output control.',
  'Verification & Quality': 'Testing and quality assurance habits. Checks for test-after-edit, review subagent usage, quality gates, and build verification.',
  'Session Strategy': 'Session structure and workflow patterns. Measures session length, task focus, frustration signals, and effective use of /continue.',
  'Configuration': 'Project setup for optimal Claude performance. Checks for CLAUDE.md presence, active hooks, custom commands, and permission modes.',
};

// ─── Component ───────────────────────────────────────────────────────

export function ReportCardPanel({ reportCard, isLoading }: ReportCardPanelProps) {
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [expandedDetector, setExpandedDetector] = useState<string | null>(null);
  const [aiRecs, setAiRecs] = useState<{ title: string; description: string; impact: string }[]>([]);
  const [aiRecsLoading, setAiRecsLoading] = useState(false);

  const fetchAiRecs = useCallback(() => {
    if (!reportCard) return;
    setAiRecsLoading(true);
    const weakDims = reportCard.dimensions.filter((d) => d.score < 70);
    fetch('/api/analytics/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalCost: 0,
        cacheHitRate: 0,
        topTools: weakDims.map((d) => ({ name: d.dimension, count: d.detectors.length, errorRate: 1 - d.score / 100 })),
        modelUsage: [],
        avgPromptLength: 0,
        compactionRate: 0,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.data)) setAiRecs(d.data); })
      .catch(() => {})
      .finally(() => setAiRecsLoading(false));
  }, [reportCard]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-[#161b22] rounded-lg animate-pulse border border-gray-800" />
        ))}
      </div>
    );
  }

  if (!reportCard) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <div className="text-gray-600 text-2xl mb-2">&#x1f4ca;</div>
          <p className="text-sm text-gray-400">Report card unavailable</p>
          <p className="text-xs text-gray-600 mt-1">
            Ensure the server is running with the latest code (restart if needed)
          </p>
        </div>
      </div>
    );
  }

  const radarData = reportCard.dimensions.map(d => ({
    dimension: SHORT_LABELS[d.label] ?? d.label,
    score: d.score,
    fullMark: 100,
  }));

  const eventCount = reportCard.dimensions.reduce((sum, d) => sum + d.detectors.length, 0);
  const isLowConfidence = eventCount < 10;

  return (
    <div className="space-y-4">
      {/* Low confidence warning */}
      {isLowConfidence && (
        <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <span className="text-xs text-amber-400">Low confidence — session has limited data. Scores may not be representative.</span>
        </div>
      )}

      {/* Grade + Score + Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Grade badge */}
        <div className={`p-4 rounded-lg border ${gradeBg(reportCard.grade)} flex flex-col items-center justify-center`}>
          <div className={`text-5xl font-bold ${gradeColor(reportCard.grade)}`}>
            {reportCard.grade}
          </div>
          <div className="text-xs text-gray-400 mt-2">
            {reportCard.overallScore}/100
          </div>
          <div className="text-xs text-gray-500 mt-1 text-center max-w-[200px]">
            {reportCard.summary.slice(0, 100)}
          </div>
        </div>

        {/* Radar chart */}
        <div className="lg:col-span-2 bg-[#161b22] rounded-lg border border-gray-800 p-3">
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="dimension" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Radar
                name="Score"
                dataKey="score"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Strengths & Improvements */}
      {(reportCard.topStrengths.length > 0 || reportCard.topImprovements.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reportCard.topStrengths.length > 0 && (
            <div className="bg-[#161b22] rounded-lg border border-gray-800 p-3">
              <h4 className="text-xs font-medium text-emerald-400 mb-2">Top Strengths</h4>
              <ul className="space-y-1">
                {reportCard.topStrengths.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                    <span className="text-emerald-500 mt-0.5 flex-shrink-0">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reportCard.topImprovements.length > 0 && (
            <div className="bg-[#161b22] rounded-lg border border-gray-800 p-3">
              <h4 className="text-xs font-medium text-amber-400 mb-2">Focus Areas</h4>
              <ul className="space-y-1">
                {reportCard.topImprovements.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">!</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Dimension cards */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Dimensions</h3>
        {reportCard.dimensions.map((dim) => (
          <DimensionCard
            key={dim.dimension}
            dimension={dim}
            isExpanded={expandedDim === dim.dimension}
            onToggle={() => setExpandedDim(expandedDim === dim.dimension ? null : dim.dimension)}
            expandedDetector={expandedDetector}
            onToggleDetector={(id) => setExpandedDetector(expandedDetector === id ? null : id)}
          />
        ))}
      </div>

      {/* AI Recommendations */}
      <div className="pt-2">
        {aiRecs.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">AI Recommendations</h3>
              <span className="px-1.5 py-0.5 text-[8px] font-medium rounded bg-blue-500/20 text-blue-400">AI</span>
            </div>
            {aiRecs.map((rec, idx) => (
              <div key={idx} className="bg-[#0d1117] border border-blue-500/10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-200">{rec.title}</span>
                  {rec.impact && <span className="text-[10px] text-emerald-400">{rec.impact}</span>}
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">{rec.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <button
            onClick={fetchAiRecs}
            disabled={aiRecsLoading}
            className="w-full px-3 py-2 text-[11px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            {aiRecsLoading ? 'Generating AI recommendations...' : 'Get AI Recommendations'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Dimension Card ──────────────────────────────────────────────────

function DimensionCard({
  dimension,
  isExpanded,
  onToggle,
  expandedDetector,
  onToggleDetector,
}: {
  dimension: DimensionScore;
  isExpanded: boolean;
  onToggle: () => void;
  expandedDetector: string | null;
  onToggleDetector: (id: string) => void;
}) {
  const passCount = dimension.detectors.filter(d => d.passed).length;
  const totalCount = dimension.detectors.length;

  return (
    <div className="bg-[#161b22] rounded-lg border border-gray-800 overflow-hidden">
      {/* Tier 1: clickable header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/30 transition-colors text-left"
      >
        <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-200">
                {dimension.label}
                {DIMENSION_DESCRIPTIONS[dimension.label] && (
                  <InfoTooltip text={DIMENSION_DESCRIPTIONS[dimension.label]} />
                )}
              </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{passCount}/{totalCount} passed</span>
              <span className="text-xs font-mono text-gray-300">{dimension.score}</span>
            </div>
          </div>
          <div className="mt-1.5 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${scoreBarColor(dimension.score)}`}
              style={{ width: `${dimension.score}%` }}
            />
          </div>
        </div>
      </button>

      {/* Tier 2: expanded detectors */}
      {isExpanded && (
        <div className="border-t border-gray-800 px-4 py-2 space-y-1">
          {dimension.detectors.map((det) => (
            <DetectorRow
              key={det.id}
              detector={det}
              isExpanded={expandedDetector === det.id}
              onToggle={() => onToggleDetector(det.id)}
            />
          ))}
          {dimension.recommendation && (
            <div className="mt-2 px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded text-xs text-blue-300">
              {dimension.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Detector Row ────────────────────────────────────────────────────

function DetectorRow({
  detector,
  isExpanded,
  onToggle,
}: {
  detector: DetectorResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-gray-800/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/20 transition-colors text-left"
      >
        <span className={`text-[10px] ${detector.passed ? 'text-emerald-500' : 'text-amber-500'}`}>
          {detector.passed ? '\u2713' : '\u2717'}
        </span>
        <span className="text-xs text-gray-300 flex-1">{detector.name}</span>
        <span className="text-[10px] font-mono text-gray-500">{detector.score}</span>
      </button>

      {/* Tier 3: evidence + recommendation */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-1">
          {detector.evidence && (
            <p className="text-[11px] text-gray-400">{detector.evidence}</p>
          )}
          {detector.recommendation && (
            <div className="px-2 py-1.5 bg-[#0d1117] border-l-2 border-blue-500/50 rounded-r text-[11px] text-blue-300">
              {detector.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
