// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useAgentStore } from '../../store/agentStore';

export type MobileTab = 'graph' | 'lenses' | 'analytics';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'graph', label: 'Graph', icon: '\u2B21' },
  { id: 'lenses', label: 'Lenses', icon: '\u25D1' },
  { id: 'analytics', label: 'Stats', icon: '\u2261' },
];

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);

  const runningCount = [...agents.values()].filter((a) => a.status === 'running').length;

  return (
    <nav
      className="flex-shrink-0 bg-[#161b22] border-t border-gray-800 flex z-[60]"
    >
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
          </span>
          <span className="mt-0.5">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
