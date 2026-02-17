import { useState, useRef, useEffect } from 'react';

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition(rect.top < 120 ? 'below' : 'above');
    }
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">(i)</span>
      {visible && (
        <span
          className={`absolute left-1/2 -translate-x-1/2 z-30 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-[11px] text-gray-200 max-w-xs whitespace-normal leading-relaxed shadow-xl pointer-events-none ${
            position === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
