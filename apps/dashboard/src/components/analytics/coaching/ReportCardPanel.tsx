import { useState } from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import type { ReportCard, DimensionScore, DetectorResult } from '@synapse-ai/core';

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

// ─── Component ───────────────────────────────────────────────────────

export function ReportCardPanel({ reportCard, isLoading }: ReportCardPanelProps) {
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [expandedDetector, setExpandedDetector] = useState<string | null>(null);

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
            <span className="text-xs font-medium text-gray-200">{dimension.label}</span>
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
