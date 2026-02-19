import { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';

const TOOL_VIEW_MODES = [
  { value: 'pillGrid' as const, label: 'Pill Grid' },
  { value: 'timeline' as const, label: 'Timeline' },
  { value: 'heatmap' as const, label: 'Heatmap' },
];

export function ViewSettingsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const lockViewport = useAgentStore((s) => s.lockViewport);
  const setLockViewport = useAgentStore((s) => s.setLockViewport);
  const showAllTools = useAgentStore((s) => s.showAllTools);
  const setShowAllTools = useAgentStore((s) => s.setShowAllTools);
  const toolGroupMode = useAgentStore((s) => s.toolGroupMode);
  const setToolGroupMode = useAgentStore((s) => s.setToolGroupMode);
  const autoClosePrompts = useAgentStore((s) => s.autoClosePrompts);
  const setAutoClosePrompts = useAgentStore((s) => s.setAutoClosePrompts);
  const showHookEvents = useAgentStore((s) => s.showHookEvents);
  const setShowHookEvents = useAgentStore((s) => s.setShowHookEvents);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const toggles = [
    { label: 'Lock Viewport', key: 'V', active: lockViewport, onToggle: () => { setLockViewport(!lockViewport); setOpen(false); } },
    { label: 'Expand Tools', key: 'F', active: showAllTools, onToggle: () => { setShowAllTools(!showAllTools); setOpen(false); } },
    { label: 'Collapse Prompts', key: 'C', active: autoClosePrompts, onToggle: () => { setAutoClosePrompts(!autoClosePrompts); setOpen(false); } },
    { label: 'Show Hook Events', key: 'H', active: showHookEvents, onToggle: () => { setShowHookEvents(!showHookEvents); setOpen(false); } },
  ];

  // Count active toggles (excluding layout which is always "active" in one mode)
  const activeCount = [lockViewport, showAllTools, autoClosePrompts, !showHookEvents].filter(Boolean).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          activeCount > 0
            ? 'text-blue-400 bg-blue-900/30 hover:bg-blue-800/40 border border-blue-700/30'
            : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
        }`}
        aria-label="View settings"
        aria-expanded={open}
        title="View settings"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1">
          <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">View</div>
          {toggles.map(({ label, key, active, onToggle }) => (
            <button
              key={key}
              onClick={onToggle}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
              role="switch"
              aria-checked={active}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="flex-1">{label}</span>
              <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">{key}</kbd>
            </button>
          ))}

          {/* Tool view mode selector */}
          <div className="border-t border-gray-700/50 mt-1 pt-1">
            <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Tool View</div>
            {TOOL_VIEW_MODES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setToolGroupMode(value); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${toolGroupMode === value ? 'bg-blue-400' : 'bg-gray-600'}`} />
                <span className="flex-1">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
