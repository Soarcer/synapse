import { useEffect, useState, useCallback } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
  /** Optional node ID — clicking the toast selects and zooms to this node */
  nodeId?: string;
}

let nextId = 0;
const listeners = new Set<(toasts: ToastItem[]) => void>();
let toasts: ToastItem[] = [];
const autoRemoveTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Registered by the graph component to handle toast click→node navigation */
let navigateToNodeFn: ((nodeId: string) => void) | null = null;

export function registerToastNavigator(fn: (nodeId: string) => void) {
  navigateToNodeFn = fn;
}

export function unregisterToastNavigator() {
  navigateToNodeFn = null;
}

function notify(updated: ToastItem[]) {
  listeners.forEach((l) => l(updated));
}

function dismissToast(id: number) {
  const timer = autoRemoveTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    autoRemoveTimers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  notify(toasts);
}

export function toast(
  message: string,
  type: ToastItem['type'] = 'info',
  nodeId?: string,
) {
  const item: ToastItem = { id: nextId++, message, type, nodeId };
  toasts = [...toasts, item];
  notify(toasts);

  const timer = setTimeout(() => {
    autoRemoveTimers.delete(item.id);
    toasts = toasts.filter((t) => t.id !== item.id);
    notify(toasts);
  }, 3000);
  autoRemoveTimers.set(item.id, timer);
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  const handleClick = useCallback((item: ToastItem) => {
    if (item.nodeId && navigateToNodeFn) {
      navigateToNodeFn(item.nodeId);
    }
    dismissToast(item.id);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-14 right-4 z-50 space-y-2 pointer-events-none" role="status" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={`
            pointer-events-auto px-4 py-2.5 rounded-lg text-sm shadow-lg border
            animate-[slideIn_0.2s_ease-out]
            ${item.nodeId ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}
            ${item.type === 'success' ? 'bg-green-900/90 border-green-700/50 text-green-200' : ''}
            ${item.type === 'error' ? 'bg-red-900/90 border-red-700/50 text-red-200' : ''}
            ${item.type === 'info' ? 'bg-gray-800/90 border-gray-700/50 text-gray-200' : ''}
          `}
          onClick={() => handleClick(item)}
        >
          {item.message}
          {item.nodeId && (
            <span className="ml-2 text-xs opacity-60">click to focus</span>
          )}
        </div>
      ))}
    </div>
  );
}
