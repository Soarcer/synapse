import { useEffect, useState, useCallback } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

let nextId = 0;
const listeners = new Set<(toasts: ToastItem[]) => void>();
let toasts: ToastItem[] = [];

function notify(toasts: ToastItem[]) {
  listeners.forEach((l) => l(toasts));
}

export function toast(message: string, type: ToastItem['type'] = 'info') {
  const item: ToastItem = { id: nextId++, message, type };
  toasts = [...toasts, item];
  notify(toasts);

  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    notify(toasts);
  }, 3000);
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    toasts = toasts.filter((t) => t.id !== id);
    notify(toasts);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-14 right-4 z-50 space-y-2 pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className={`
            pointer-events-auto px-4 py-2.5 rounded-lg text-sm shadow-lg border
            animate-[slideIn_0.2s_ease-out]
            ${item.type === 'success' ? 'bg-green-900/90 border-green-700/50 text-green-200' : ''}
            ${item.type === 'error' ? 'bg-red-900/90 border-red-700/50 text-red-200' : ''}
            ${item.type === 'info' ? 'bg-gray-800/90 border-gray-700/50 text-gray-200' : ''}
          `}
          onClick={() => dismiss(item.id)}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
