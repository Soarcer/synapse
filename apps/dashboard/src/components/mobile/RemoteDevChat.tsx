// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useRef, useEffect, useState } from 'react';
import {
  useRemoteDevStore,
  type ChatMessage,
  type RemoteDevStatus,
} from '../../store/remoteDevStore';

// Module-level empty arrays to avoid Zustand re-render loops
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIONS: string[] = [];

export function RemoteDevChat() {
  const messages = useRemoteDevStore((s) => (s.messages.length > 0 ? s.messages : EMPTY_MESSAGES));
  const status = useRemoteDevStore((s) => s.status);
  const quickActions = useRemoteDevStore((s) =>
    s.quickActions.length > 0 ? s.quickActions : EMPTY_ACTIONS,
  );
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, status]);

  const handleSend = (text: string) => {
    if (!text.trim() || status !== 'waiting') return;
    useRemoteDevStore.getState().sendAnswer(text.trim());
    setInputText('');
  };

  // Empty state
  if (status === 'idle' && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="text-gray-500 text-sm max-w-xs">
          <div className="text-2xl mb-3">⌘</div>
          <p>
            Start a Claude Code session on your PC and run{' '}
            <code className="text-blue-400">/remote-dev</code> — then come back here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Remote Dev</span>
        <StatusBadge status={status} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {status === 'working' && <WorkingIndicator />}
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 && status === 'waiting' && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-gray-800/50 flex gap-1.5 overflow-x-auto">
          {quickActions.map((label) => (
            <button
              key={label}
              onClick={() => handleSend(label)}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-700 bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-gray-300 transition-colors whitespace-nowrap flex-shrink-0"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(inputText);
            }
          }}
          disabled={status !== 'waiting'}
          placeholder="Type instruction..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-40"
        />
        <button
          onClick={() => handleSend(inputText)}
          disabled={status !== 'waiting' || !inputText.trim()}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}

// Stale watchdog — shows "(no response for Xm)" after 3 minutes of working
const STALE_THRESHOLD_MS = 3 * 60_000;

function WorkingIndicator() {
  const [staleMinutes, setStaleMinutes] = useState(0);
  const clear = useRemoteDevStore((s) => s.clear);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= STALE_THRESHOLD_MS) {
        setStaleMinutes(Math.floor(elapsed / 60_000));
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-gray-500 text-xs py-1">
      <span className="animate-pulse">⏳</span>
      <span>Working...</span>
      {staleMinutes >= 3 && (
        <span className="text-amber-500/70">
          (no response for {staleMinutes}m —{' '}
          <button onClick={() => clear()} className="underline hover:text-amber-400">
            reset
          </button>
          )
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RemoteDevStatus }) {
  if (status === 'idle') return <span className="text-[10px] text-gray-600">Idle</span>;
  if (status === 'waiting')
    return (
      <span className="text-[10px] text-amber-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Waiting
      </span>
    );
  return (
    <span className="text-[10px] text-blue-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      Working
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        data-error={message.isError ? 'true' : undefined}
        className={`max-w-[85%] px-3 py-1.5 rounded-lg text-sm ${
          isUser
            ? 'bg-blue-600/20 text-blue-200'
            : message.isError
              ? 'bg-red-900/30 border border-red-700/50 text-red-300'
              : 'bg-gray-800 text-gray-300'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    </div>
  );
}
