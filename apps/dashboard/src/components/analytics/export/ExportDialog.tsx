// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useCallback } from 'react';
import type { MockData } from '../mockData';

interface ExportDialogProps {
  data: MockData;
  onClose: () => void;
}

type ExportFormat = 'html' | 'csv' | 'json';
type ExportSection = 'overview' | 'sessions' | 'tools' | 'models' | 'turns';

const SECTIONS: { id: ExportSection; label: string; description: string }[] = [
  { id: 'overview', label: 'Overview', description: 'KPI summary and totals' },
  { id: 'sessions', label: 'Sessions', description: 'All session details' },
  { id: 'tools', label: 'Tool Usage', description: 'Tool call breakdown' },
  { id: 'models', label: 'Model Usage', description: 'Per-model metrics' },
  { id: 'turns', label: 'Turn Details', description: 'Per-turn token & cost data' },
];

// ─── Export Generators ──────────────────────────────────────────────

function generateCsv(data: MockData, sections: Set<ExportSection>): string {
  const lines: string[] = [];

  if (sections.has('sessions')) {
    lines.push('# Sessions');
    lines.push(
      'id,name,model,vendor,start_time,end_time,input_tokens,output_tokens,cache_read_tokens,cost_usd,tool_calls,prompts,compactions,avg_latency_ms',
    );
    for (const s of data.sessions) {
      lines.push(
        [
          s.id,
          `"${s.name}"`,
          s.model,
          s.vendor,
          new Date(s.startTime).toISOString(),
          new Date(s.endTime).toISOString(),
          s.totalInputTokens,
          s.totalOutputTokens,
          s.totalCacheReadTokens,
          s.totalCost.toFixed(6),
          s.toolCalls,
          s.promptCount,
          s.compactions,
          s.avgLatencyMs,
        ].join(','),
      );
    }
    lines.push('');
  }

  if (sections.has('turns')) {
    lines.push('# Turns');
    lines.push(
      'session_id,turn_index,timestamp,prompt,input_tokens,output_tokens,cache_read_tokens,cost_usd,tool_count,tools,model,latency_ms',
    );
    for (const t of data.turns) {
      lines.push(
        [
          t.sessionId,
          t.turnIndex,
          new Date(t.timestamp).toISOString(),
          `"${t.promptText.replace(/"/g, '""')}"`,
          t.inputTokens,
          t.outputTokens,
          t.cacheReadTokens,
          t.costUsd.toFixed(6),
          t.toolCount,
          `"${t.toolNames.join(';')}"`,
          t.model,
          t.latencyMs,
        ].join(','),
      );
    }
    lines.push('');
  }

  if (sections.has('tools')) {
    lines.push('# Tool Calls');
    lines.push('session_id,tool_name,timestamp,duration_ms,status');
    for (const tc of data.toolCalls) {
      lines.push(
        [
          tc.sessionId,
          tc.toolName,
          new Date(tc.timestamp).toISOString(),
          tc.durationMs,
          tc.status,
        ].join(','),
      );
    }
  }

  return lines.join('\n');
}

function generateJson(data: MockData, sections: Set<ExportSection>): string {
  const exported: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    timeRange: data.timeRange,
  };

  if (sections.has('overview')) {
    exported.overview = {
      totalSessions: data.sessions.length,
      totalCost: data.sessions.reduce((s, sess) => s + sess.totalCost, 0),
      totalInputTokens: data.sessions.reduce((s, sess) => s + sess.totalInputTokens, 0),
      totalOutputTokens: data.sessions.reduce((s, sess) => s + sess.totalOutputTokens, 0),
      totalToolCalls: data.toolCalls.length,
    };
  }
  if (sections.has('sessions')) exported.sessions = data.sessions;
  if (sections.has('turns')) exported.turns = data.turns;
  if (sections.has('tools')) exported.toolCalls = data.toolCalls;
  if (sections.has('models')) {
    const modelMap = new Map<string, { sessions: number; cost: number; tokens: number }>();
    for (const s of data.sessions) {
      const e = modelMap.get(s.model) || { sessions: 0, cost: 0, tokens: 0 };
      e.sessions++;
      e.cost += s.totalCost;
      e.tokens += s.totalInputTokens + s.totalOutputTokens;
      modelMap.set(s.model, e);
    }
    exported.models = Object.fromEntries(modelMap);
  }

  return JSON.stringify(exported, null, 2);
}

function generateHtml(data: MockData, sections: Set<ExportSection>): string {
  const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
  const totalTokens = data.sessions.reduce(
    (s, sess) => s + sess.totalInputTokens + sess.totalOutputTokens,
    0,
  );

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synapse Analytics Report — ${new Date().toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; padding: 2rem; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; color: #f0f6fc; }
    .header p { font-size: 0.75rem; color: #8b949e; margin-top: 0.25rem; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .kpi-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1rem; }
    .kpi-label { font-size: 0.65rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi-value { font-size: 1.5rem; font-weight: 700; color: #f0f6fc; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th { text-align: left; font-size: 0.7rem; color: #8b949e; padding: 0.5rem; border-bottom: 1px solid #30363d; }
    td { font-size: 0.75rem; color: #e6edf3; padding: 0.5rem; border-bottom: 1px solid #21262d; }
    tr:hover td { background: #161b22; }
    h2 { font-size: 1rem; color: #f0f6fc; margin: 1.5rem 0 0.75rem; }
    .footer { text-align: center; font-size: 0.65rem; color: #484f58; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #21262d; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Synapse Analytics Report</h1>
    <p>Generated ${new Date().toLocaleString()} — ${data.sessions.length} sessions</p>
  </div>`;

  if (sections.has('overview')) {
    html += `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Total Cost</div><div class="kpi-value">$${totalCost.toFixed(2)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Tokens</div><div class="kpi-value">${(totalTokens / 1_000_000).toFixed(2)}M</div></div>
    <div class="kpi-card"><div class="kpi-label">Sessions</div><div class="kpi-value">${data.sessions.length}</div></div>
    <div class="kpi-card"><div class="kpi-label">Tool Calls</div><div class="kpi-value">${data.toolCalls.length.toLocaleString()}</div></div>
  </div>`;
  }

  if (sections.has('sessions')) {
    html += `
  <h2>Sessions</h2>
  <table>
    <thead><tr><th>Session</th><th>Model</th><th>Cost</th><th>Tokens</th><th>Tools</th><th>Duration</th></tr></thead>
    <tbody>`;
    for (const s of data.sessions) {
      const duration = Math.round((s.endTime - s.startTime) / 60_000);
      html += `
      <tr>
        <td>${s.name || s.id.slice(0, 8)}</td>
        <td>${s.model}</td>
        <td>$${s.totalCost.toFixed(4)}</td>
        <td>${(s.totalInputTokens + s.totalOutputTokens).toLocaleString()}</td>
        <td>${s.toolCalls}</td>
        <td>${duration}m</td>
      </tr>`;
    }
    html += `
    </tbody>
  </table>`;
  }

  html += `
  <div class="footer">Generated by Synapse — AI Agent Orchestration Dashboard</div>
</body>
</html>`;

  return html;
}

// ─── Component ──────────────────────────────────────────────────────

export function ExportDialog({ data, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('html');
  const [selectedSections, setSelectedSections] = useState<Set<ExportSection>>(
    new Set(['overview', 'sessions', 'tools', 'models']),
  );
  const [isExporting, setIsExporting] = useState(false);

  const toggleSection = (section: ExportSection) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleExport = useCallback(() => {
    setIsExporting(true);
    try {
      let content: string;
      let mimeType: string;
      let extension: string;

      switch (format) {
        case 'csv':
          content = generateCsv(data, selectedSections);
          mimeType = 'text/csv';
          extension = 'csv';
          break;
        case 'json':
          content = generateJson(data, selectedSections);
          mimeType = 'application/json';
          extension = 'json';
          break;
        default:
          content = generateHtml(data, selectedSections);
          mimeType = 'text/html';
          extension = 'html';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `synapse-analytics-${new Date().toISOString().split('T')[0]}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }, [data, format, selectedSections]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#161b22] border border-gray-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-100">Export Analytics</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">
            &times;
          </button>
        </div>

        {/* Format Selector */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 mb-2 block">Format</label>
          <div className="flex gap-2">
            {(['html', 'csv', 'json'] as ExportFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  format === f
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                    : 'bg-[#0d1117] border-gray-700 text-gray-400 hover:text-gray-300'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Section Picker */}
        <div className="mb-6">
          <label className="text-xs text-gray-400 mb-2 block">Sections to include</label>
          <div className="space-y-2">
            {SECTIONS.map((section) => (
              <label key={section.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedSections.has(section.id)}
                  onChange={() => toggleSection(section.id)}
                  className="rounded border-gray-600 bg-[#0d1117] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                />
                <div>
                  <span className="text-xs text-gray-300 group-hover:text-gray-100">
                    {section.label}
                  </span>
                  <span className="text-[10px] text-gray-600 ml-2">{section.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Preview info */}
        <div className="bg-[#0d1117] border border-gray-800 rounded-lg p-3 mb-4">
          <div className="text-[10px] text-gray-500">
            {data.sessions.length} sessions, {data.turns.length} turns, {data.toolCalls.length} tool
            calls — {selectedSections.size} section(s) selected
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={selectedSections.size === 0 || isExporting}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
          >
            {isExporting ? 'Exporting...' : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
