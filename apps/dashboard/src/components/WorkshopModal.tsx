// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../store/agentStore';
import { PromptWorkshop } from './analytics/workshop/PromptWorkshop';
import type { AnalysisMode } from './analytics/prompts/PromptAnalyzer';
import { Tooltip } from './ui/Tooltip';

const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast & cheap' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', desc: 'Balanced' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable' },
] as const;

export function WorkshopModal() {
  const show = useAgentStore((s) => s.showWorkshop);
  const close = useAgentStore((s) => s.setShowWorkshop);
  const [mode, setMode] = useState<AnalysisMode>('developer');
  const [modelId, setModelId] = useState<(typeof MODEL_OPTIONS)[number]['id']>(MODEL_OPTIONS[0].id);

  const handleClose = useCallback(() => close(false), [close]);

  // Close on Escape
  useEffect(() => {
    if (!show) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [show, handleClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-12 px-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Prompt Lab"
    >
      <div
        className="w-full max-w-4xl max-h-[calc(100vh-6rem)] bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-100">Prompt Lab</h2>
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-gray-700 overflow-hidden">
              <Tooltip content="Technical analysis — token metrics and structural critique">
                <button
                  onClick={() => setMode('developer')}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    mode === 'developer'
                      ? 'bg-blue-500/15 text-blue-400 border-r border-blue-500/30'
                      : 'text-gray-500 hover:text-gray-300 border-r border-gray-700'
                  }`}
                >
                  Developer
                </button>
              </Tooltip>
              <Tooltip content="Plain-language feedback — conversational coaching">
                <button
                  onClick={() => setMode('vibe')}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    mode === 'vibe'
                      ? 'bg-purple-500/15 text-purple-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Vibe
                </button>
              </Tooltip>
            </div>
          </div>
          {/* Model selector — right-aligned */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-700 overflow-hidden">
              {MODEL_OPTIONS.map((m, i) => (
                <Tooltip key={m.id} content={m.desc}>
                  <button
                    onClick={() => setModelId(m.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      modelId === m.id
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }${i < MODEL_OPTIONS.length - 1 ? (modelId === m.id ? ' border-r border-emerald-500/30' : ' border-r border-gray-700') : ''}`}
                  >
                    {m.label}
                  </button>
                </Tooltip>
              ))}
            </div>
            <Tooltip content="Close Prompt Lab" shortcut="Esc">
              <button
                onClick={handleClose}
                className="p-1 text-gray-500 hover:text-gray-200 transition-colors rounded"
                aria-label="Close Prompt Lab"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <PromptWorkshop analysisMode={mode} modelId={modelId} sessions={[]} turns={[]} />
        </div>
      </div>
    </div>
  );
}
