// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../../utils/api';
import type { AiCoachStatus } from '@synapse-ai/core';

interface SettingsPanelProps {
  onClose: () => void;
}

interface SettingsData {
  anthropic_api_key?: string;
  ai_coach_model?: string;
  ai_coach_enabled?: string;
  ai_token_budget_usd?: string;
  _api_key_source?: string;
}

const MODEL_OPTIONS = [
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    desc: 'Fastest, cheapest ($0.80/1M in, $4/1M out)',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Sonnet 4.5',
    desc: 'Balanced ($3/1M in, $15/1M out)',
  },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable ($15/1M in, $75/1M out)' },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<SettingsData>({});
  const [aiStatus, setAiStatus] = useState<AiCoachStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch(apiUrl('/api/settings')),
        fetch(apiUrl('/api/settings/ai-status')),
      ]);
      const settingsData = await settingsRes.json();
      const statusData = await statusRes.json();
      setSettings(settingsData.data ?? {});
      setAiStatus(statusData.data ?? null);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (updates: Record<string, string>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Settings saved' });
        await fetchSettings();
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Connection error' });
    }
    setSaving(false);
  };

  const handleSetApiKey = () => {
    if (!apiKeyInput.trim()) return;
    handleSave({ anthropic_api_key: apiKeyInput.trim() });
    setApiKeyInput('');
  };

  const handleModelChange = (model: string) => {
    handleSave({ ai_coach_model: model });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#161b22] border border-gray-700 rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">AI Coach Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            &#x2715;
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="h-32 flex items-center justify-center">
              <span className="text-sm text-gray-500">Loading...</span>
            </div>
          ) : (
            <>
              {/* API Key Status */}
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-2">
                  Anthropic API Key
                </label>
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    aiStatus?.available
                      ? 'bg-emerald-500/10 border-emerald-500/20'
                      : 'bg-red-500/10 border-red-500/20'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${aiStatus?.available ? 'bg-emerald-500' : 'bg-red-500'}`}
                  />
                  <span className="text-xs text-gray-300 flex-1">
                    {aiStatus?.available
                      ? `Active (${settings._api_key_source === 'env' ? 'from env' : 'from settings'}): ${settings.anthropic_api_key ?? ''}`
                      : 'Not configured'}
                  </span>
                </div>
                {settings._api_key_source !== 'env' && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="sk-ant-..."
                      className="flex-1 bg-[#0d1117] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      onClick={handleSetApiKey}
                      disabled={saving || !apiKeyInput.trim()}
                      className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-lg text-xs text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                )}
                {settings._api_key_source === 'env' && (
                  <p className="text-[10px] text-gray-600 mt-1">
                    Detected from ANTHROPIC_API_KEY environment variable. To override, set it in
                    settings.
                  </p>
                )}
              </div>

              {/* Coach Model */}
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium block mb-2">
                  Coach Model
                </label>
                <div className="space-y-1.5">
                  {MODEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => handleModelChange(opt.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
                        (settings.ai_coach_model ?? 'claude-haiku-4-5-20251001') === opt.id
                          ? 'bg-blue-500/10 border-blue-500/30 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-300'
                      }`}
                    >
                      <div className="flex-1">
                        <div className="text-xs font-medium">{opt.label}</div>
                        <div className="text-[10px] text-gray-500">{opt.desc}</div>
                      </div>
                      {(settings.ai_coach_model ?? 'claude-haiku-4-5-20251001') === opt.id && (
                        <span className="text-blue-400 text-xs">&#x2713;</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message */}
              {message && (
                <div
                  className={`px-3 py-2 rounded-lg text-xs ${
                    message.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {message.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 rounded-lg text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
