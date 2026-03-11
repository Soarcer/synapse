// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useNotificationStore } from './notificationStore';
import { NOTIFICATIONS_ENABLED } from './constants';

interface Props {
  onClose: () => void;
}

export function NotificationSettings({ onClose }: Props) {
  const enabled = useNotificationStore((s) => s.enabled);
  const setEnabled = useNotificationStore((s) => s.setEnabled);
  const showToasts = useNotificationStore((s) => s.showToasts);
  const setShowToasts = useNotificationStore((s) => s.setShowToasts);
  const showPulse = useNotificationStore((s) => s.showPulse);
  const setShowPulse = useNotificationStore((s) => s.setShowPulse);

  if (!NOTIFICATIONS_ENABLED) return null;

  const toggles = [
    {
      label: 'Show Alerts',
      key: 'A',
      active: enabled,
      onToggle: () => {
        setEnabled(!enabled);
        onClose();
      },
    },
    {
      label: 'Toast Popups',
      key: '',
      active: showToasts,
      onToggle: () => {
        setShowToasts(!showToasts);
        onClose();
      },
    },
    {
      label: 'Graph Pulse',
      key: '',
      active: showPulse,
      onToggle: () => {
        setShowPulse(!showPulse);
        onClose();
      },
    },
  ];

  return (
    <div className="border-t border-gray-700/50 mt-1 pt-1">
      <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">
        Notifications
      </div>
      {toggles.map(({ label, key, active, onToggle }) => (
        <button
          key={label}
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
          role="switch"
          aria-checked={active}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-green-400' : 'bg-gray-600'}`}
          />
          <span className="flex-1">{label}</span>
          {key && <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">{key}</kbd>}
        </button>
      ))}
    </div>
  );
}
