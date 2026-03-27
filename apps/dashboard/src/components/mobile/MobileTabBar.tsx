// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useAgentStore } from '../../store/agentStore';
import { useRemoteDevStore } from '../../store/remoteDevStore';
import { Features } from '@synapse-ai/core';

export type MobileTab = 'graph' | 'lenses' | 'analytics' | 'dev';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const ALL_TABS: Array<{ id: MobileTab; label: string; icon: string; enabled: boolean }> = [
  { id: 'graph', label: 'Graph', icon: '\u2B21', enabled: true },
  { id: 'lenses', label: 'Lenses', icon: '\u25D1', enabled: true },
  { id: 'analytics', label: 'Stats', icon: '\u2261', enabled: true },
  { id: 'dev', label: 'Dev', icon: '\u2318', enabled: Features.remoteDevChat },
];
const TABS = ALL_TABS.filter((t) => t.enabled);

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const runningCount = useAgentStore((s) => {
    let count = 0;
    for (const a of s.agents.values()) if (a.status === 'running') count++;
    return count;
  });
  const remoteDevStatus = useRemoteDevStore((s) => s.status);

  return (
    <nav className="flex-shrink-0 bg-syn-bg-surface border-t border-gray-800 flex z-[60]">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center py-0.5 text-xs transition-colors ${
            activeTab === tab.id ? 'text-blue-400' : 'text-gray-500'
          }`}
        >
          <span className="text-lg relative">
            {tab.icon}
            {tab.id === 'graph' && (
              <span
                className={`absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
            )}
            {tab.id === 'lenses' && runningCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-blue-600 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                {runningCount > 9 ? '9+' : runningCount}
              </span>
            )}
            {tab.id === 'dev' && remoteDevStatus === 'waiting' && (
              <span className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </span>
          <span className="mt-0.5">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
