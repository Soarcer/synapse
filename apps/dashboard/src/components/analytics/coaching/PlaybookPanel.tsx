// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';
import type { Playbook, PlaybookCategory } from '@synapse-ai/core';

interface PlaybookPanelProps {
  playbooks: Playbook[];
  sessionId: string | null;
  onRefresh: () => void;
}

const ONBOARDING_KEY = 'synapse-templates-onboarding-dismissed';

const CATEGORY_COLORS: Record<PlaybookCategory, string> = {
  feature: 'bg-blue-500/20 text-blue-400',
  bugfix: 'bg-red-500/20 text-red-400',
  refactor: 'bg-purple-500/20 text-purple-400',
  test: 'bg-emerald-500/20 text-emerald-400',
  review: 'bg-amber-500/20 text-amber-400',
  debug: 'bg-orange-500/20 text-orange-400',
  custom: 'bg-gray-500/20 text-gray-400',
};

const ALL_CATEGORIES: PlaybookCategory[] = [
  'feature',
  'bugfix',
  'refactor',
  'test',
  'review',
  'debug',
  'custom',
];

export function PlaybookPanel({ playbooks, sessionId, onRefresh }: PlaybookPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PlaybookCategory | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDING_KEY) && playbooks.length === 0) {
        setShowOnboarding(true);
      }
    } catch {
      /* ignore */
    }
  }, [playbooks.length]);

  const filtered = playbooks.filter((p) => {
    if (selectedCategory && p.category !== selectedCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleSaveSession = async () => {
    if (!sessionId) return;
    setIsSaving(true);
    try {
      await fetch(
        apiUrl(
          `/api/analytics/coaching/playbooks/from-session?sessionId=${encodeURIComponent(sessionId)}`,
        ),
        {
          method: 'POST',
        },
      );
      onRefresh();
    } catch {
      /* ignore */
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(apiUrl(`/api/analytics/coaching/playbooks/${id}`), { method: 'DELETE' });
      onRefresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + filters + save button */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#161b22] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none flex-1 min-w-[200px]"
        />

        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-2 py-1 text-[10px] rounded-full border transition-colors ${
              selectedCategory === null
                ? 'bg-gray-700/50 text-gray-200 border-gray-600'
                : 'text-gray-500 border-transparent hover:border-gray-700'
            }`}
          >
            All
          </button>
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`px-2 py-1 text-[10px] rounded-full border transition-colors capitalize ${
                selectedCategory === cat
                  ? `${CATEGORY_COLORS[cat]} border-current`
                  : 'text-gray-500 border-transparent hover:border-gray-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {sessionId && (
          <button
            onClick={handleSaveSession}
            disabled={isSaving}
            className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-lg text-xs text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Session as Template'}
          </button>
        )}
      </div>

      {/* Onboarding card */}
      {showOnboarding && (
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-gray-200 mb-1">
                What are Session Templates?
              </h4>
              <p className="text-xs text-gray-400 leading-relaxed mb-2">
                Session Templates capture the patterns of your best coding sessions — which tools
                were used, in what order, how many turns it took, and whether tests were run after
                edits. Use them as benchmarks to replicate successful workflows.
              </p>
              <ul className="space-y-1 text-xs text-gray-400">
                <li className="flex items-center gap-1.5">
                  <span className="text-blue-400">1.</span> Complete a coding session with Claude
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-blue-400">2.</span> Click "Save Session as Template" to
                  capture the pattern
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-blue-400">3.</span> Compare future sessions against your
                  best templates
                </li>
              </ul>
            </div>
            <button
              onClick={() => {
                setShowOnboarding(false);
                try {
                  localStorage.setItem(ONBOARDING_KEY, '1');
                } catch {
                  /* ignore */
                }
              }}
              className="text-gray-600 hover:text-gray-400 transition-colors text-xs flex-shrink-0"
            >
              &#x2715;
            </button>
          </div>
        </div>
      )}

      {/* Template cards */}
      {filtered.length === 0 && !showOnboarding ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="text-gray-600 text-3xl mb-3">&#x1f4d6;</div>
            <p className="text-sm text-gray-400">No session templates yet</p>
            <p className="text-xs text-gray-600 mt-1">
              Save a session as a template to build your collection
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? null : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((playbook) => (
            <PlaybookCard
              key={playbook.id}
              playbook={playbook}
              isExpanded={expandedId === playbook.id}
              onToggle={() => setExpandedId(expandedId === playbook.id ? null : playbook.id)}
              onDelete={() => handleDelete(playbook.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaybookCard({
  playbook,
  isExpanded,
  onToggle,
  onDelete,
}: {
  playbook: Playbook;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-[#161b22] rounded-lg border border-gray-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded capitalize ${CATEGORY_COLORS[playbook.category]}`}
              >
                {playbook.category}
              </span>
              <h4 className="text-xs font-medium text-gray-200 truncate">{playbook.name}</h4>
            </div>
            <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{playbook.description}</p>
          </div>
          {playbook.score != null && (
            <span className="text-xs font-mono text-gray-400">{playbook.score}</span>
          )}
        </div>

        {/* Tags */}
        {playbook.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {playbook.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] bg-gray-800 text-gray-400 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="border-t border-gray-800 px-4 py-3 space-y-3">
          {/* Pattern metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricItem label="Avg Turns" value={String(playbook.pattern.avgTurns)} />
            <MetricItem label="Duration" value={`${playbook.pattern.avgDurationMinutes}m`} />
            <MetricItem
              label="Model"
              value={playbook.pattern.modelStrategy.split('-').pop() ?? '?'}
            />
            <MetricItem label="Compactions" value={String(playbook.pattern.compactionCount)} />
          </div>

          {/* Pattern flags */}
          <div className="flex items-center gap-3 flex-wrap">
            <PatternFlag label="Read before Edit" value={playbook.pattern.readBeforeEdit} />
            <PatternFlag label="Test after Edit" value={playbook.pattern.testAfterEdit} />
            <PatternFlag label="Subagents" value={playbook.pattern.usedSubagents} />
          </div>

          {/* Tool sequence preview */}
          {playbook.pattern.toolSequence.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                Tool Sequence
              </span>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {playbook.pattern.toolSequence.slice(0, 15).map((tool, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 text-[10px] bg-gray-800/50 text-gray-400 rounded font-mono"
                  >
                    {tool}
                  </span>
                ))}
                {playbook.pattern.toolSequence.length > 15 && (
                  <span className="text-[10px] text-gray-600">
                    +{playbook.pattern.toolSequence.length - 15} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Source + actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800/50">
            <span className="text-[10px] text-gray-600">
              {playbook.sourceSessionId
                ? `From session ${playbook.sourceSessionId.slice(0, 8)}`
                : 'Manual template'}
              {' \u00b7 '}
              {new Date(playbook.createdAt).toLocaleDateString()}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-[10px] text-red-500/60 hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0d1117] rounded px-2 py-1.5">
      <div className="text-[10px] text-gray-600">{label}</div>
      <div className="text-xs font-mono text-gray-300">{value}</div>
    </div>
  );
}

function PatternFlag({ label, value }: { label: string; value: boolean }) {
  return (
    <span className={`text-[10px] ${value ? 'text-emerald-500' : 'text-gray-600'}`}>
      {value ? '\u2713' : '\u2717'} {label}
    </span>
  );
}
