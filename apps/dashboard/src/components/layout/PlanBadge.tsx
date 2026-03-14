// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useState, useRef } from 'react';
import { Tooltip } from '../ui/Tooltip';
import { apiUrl } from '../../utils/api';

interface PlanInfo {
  plan: string;
  source: 'auto' | 'manual';
  monthlyLimit: number | null;
  detected: boolean;
}

interface PlanOption {
  value: string;
  label: string;
  limit: number | null;
}

const FALLBACK_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro $20/mo',
  max_5x: 'Max 5× $100/mo',
  max_20x: 'Max 20× $200/mo',
  team: 'Team $30/user/mo',
  api: 'API (pay-per-use)',
};

interface PlanBadgeProps {
  plan: PlanInfo;
  onPlanChange: (updated: PlanInfo) => void;
}

export function PlanBadge({ plan, onPlanChange }: PlanBadgeProps) {
  const [options, setOptions] = useState<PlanOption[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch plan options from existing combined endpoint when popover opens
  useEffect(() => {
    if (!open || options.length > 0) return;
    fetch(apiUrl('/api/analytics/budget/plans'))
      .then((r) => r.json())
      .then((res) => {
        const labels: Record<string, string> = res?.data?.labels ?? FALLBACK_LABELS;
        const limits: Record<string, number | null> = res?.data?.limits ?? {};
        setOptions(
          Object.entries(labels).map(([value, label]) => ({
            value,
            label,
            limit: limits[value] ?? null,
          })),
        );
      })
      .catch(() => {
        setOptions(
          Object.entries(FALLBACK_LABELS).map(([value, label]) => ({
            value,
            label,
            limit: null,
          })),
        );
      });
  }, [open, options.length]);

  // Click-outside to close (matches ViewSettingsDropdown pattern)
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selectPlan = (planName: string) => {
    setSaving(true);
    fetch(apiUrl('/api/analytics/budget/plan'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planName }),
    })
      .then((r) => r.json())
      .then((res) => {
        const d = res?.data;
        if (d) {
          const updated: PlanInfo = {
            plan: d.plan,
            source: d.source ?? 'manual',
            monthlyLimit: d.monthlyLimit ?? null,
            detected: true,
          };
          onPlanChange(updated);
        }
        setOpen(false);
      })
      .catch(() => {
        // Keep popover open on error so user can retry
      })
      .finally(() => setSaving(false));
  };

  const label = FALLBACK_LABELS[plan.plan] ?? plan.plan;

  const badge = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors
        ${
          !plan.detected
            ? 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
            : plan.plan === 'api'
              ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              : plan.source === 'auto'
                ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          !plan.detected
            ? 'bg-gray-400'
            : plan.plan === 'api'
              ? 'bg-blue-400'
              : plan.source === 'auto'
                ? 'bg-green-400'
                : 'bg-amber-400'
        }`}
      />
      {!plan.detected ? `${label}?` : label}
    </button>
  );

  return (
    <div ref={ref} className="relative inline-flex">
      {/* Suppress tooltip when popover is open to avoid visual overlap */}
      {open ? (
        badge
      ) : (
        <Tooltip
          content={
            !plan.detected
              ? 'Plan not detected — click to set'
              : plan.source === 'auto'
                ? 'Auto-detected from Claude config'
                : 'Manually set — click to change'
          }
        >
          {badge}
        </Tooltip>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1 text-xs">
          <div className="px-3 py-1.5 text-gray-500 font-medium border-b border-gray-800">
            Select plan
          </div>
          {options.length === 0 ? (
            <div className="px-3 py-2 text-gray-500">Loading...</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => selectPlan(opt.value)}
                className={`w-full text-left px-3 py-1.5 transition-colors
                  ${
                    opt.value === plan.plan
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-800'
                  }
                  ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
