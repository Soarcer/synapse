// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useEffect } from 'react';
import { useLens } from './LensContext';
import { Tooltip } from '../ui/Tooltip';
import { useNotificationStore } from '../../features/notifications/notificationStore'; // [notifications]

import type { LensTab } from './LensContext';

const TABS: { key: LensTab; label: string; fullName: string; shortcut: string }[] = [
  { key: 'treemap', label: 'TMap', fullName: 'Cost and token area treemap', shortcut: '1' },
  { key: 'heatmap', label: 'Heat', fullName: 'Tool call frequency heatmap', shortcut: '2' },
  { key: 'compaction', label: 'Comp', fullName: 'Context compaction timeline', shortcut: '3' },
  { key: 'cost', label: 'Cost', fullName: 'Per-turn cost waterfall', shortcut: '4' },
  { key: 'sankey', label: 'Flow', fullName: 'Token flow Sankey diagram', shortcut: '5' },
  { key: 'tree', label: 'Tree', fullName: 'Hierarchical session tree', shortcut: '6' },
  { key: 'alerts', label: 'Alerts', fullName: 'Notification alerts', shortcut: '7' }, // [notifications]
];

// Detect VS Code: either the webview sets data-vscode-theme-kind on <html>,
// or the dashboard is loaded inside an iframe (sidebar/panel) whose parent differs.
const isVSCode =
  typeof document !== 'undefined' &&
  (document.documentElement.hasAttribute('data-vscode-theme-kind') ||
    window.parent !== window);

function GraphOpenButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVSCode || !open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isVSCode) return null;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center border border-gray-600 rounded overflow-hidden">
        {/* Main action: open in side panel */}
        <button
          onClick={() => window.parent.postMessage({ type: 'openGraphPanel' }, '*')}
          className="px-2 py-1 text-[11px] font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
          aria-label="Open graph in side panel"
        >
          Node Graph
        </button>
        {/* Chevron toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-1 py-1 text-[11px] text-gray-400 bg-gray-800 hover:bg-gray-700 border-l border-gray-600 transition-colors"
          aria-label="More open options"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
            <path
              d="M1 2.5 L4 5.5 L7 2.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-gray-900 border border-gray-700 rounded shadow-lg py-0.5">
          <button
            onClick={() => {
              setOpen(false);
              window.parent.postMessage({ type: 'openGraphPanel' }, '*');
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Open in side panel
          </button>
          <button
            onClick={() => {
              setOpen(false);
              window.parent.postMessage({ type: 'openGraphInBrowser' }, '*');
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Open in browser
          </button>
        </div>
      )}
    </div>
  );
}

export function LensTabBar() {
  const { activeTab, onTabChange, statusCounts, onSpawnClick } = useLens();
  const notifCount = useNotificationStore((s) => s.notifications.length); // [notifications]

  const total =
    statusCounts.running + statusCounts.success + statusCounts.error + statusCounts.stopped;

  return (
    <div className="flex-shrink-0">
      {/* Tab buttons + spawn */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-gray-800">
        {TABS.map((tab) => (
          <Tooltip key={tab.key} content={tab.fullName} shortcut={tab.shortcut}>
            <button
              onClick={() => onTabChange(tab.key)}
              className={`
                relative px-2 py-1 rounded text-[11px] font-medium transition-colors
                ${
                  activeTab === tab.key
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                }
              `}
            >
              {tab.label}
              {/* [notifications] */}
              {tab.key === 'alerts' && notifCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.5)]">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <GraphOpenButton />
          {/* TODO v0.2.0: Spawn Agent deferred — needs output panel + conversation model
          <Tooltip content="Spawn Agent" shortcut="N">
            <button
              onClick={onSpawnClick}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11px] text-white font-medium transition-colors"
            >
              +
            </button>
          </Tooltip>
          */}
        </div>
      </div>

      {/* Status strip */}
      {total > 0 && (
        <div className="flex h-0.5">
          {statusCounts.running > 0 && (
            <div
              className="bg-green-400"
              style={{ width: `${(statusCounts.running / total) * 100}%` }}
            />
          )}
          {statusCounts.success > 0 && (
            <div
              className="bg-gray-500"
              style={{ width: `${(statusCounts.success / total) * 100}%` }}
            />
          )}
          {statusCounts.error > 0 && (
            <div
              className="bg-red-400"
              style={{ width: `${(statusCounts.error / total) * 100}%` }}
            />
          )}
          {statusCounts.stopped > 0 && (
            <div
              className="bg-yellow-400"
              style={{ width: `${(statusCounts.stopped / total) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
