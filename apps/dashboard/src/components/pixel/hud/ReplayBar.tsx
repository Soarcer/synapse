import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReplayController } from '../modes/ReplayController';

interface ReplayBarProps {
  controller: ReplayController;
}

const SPEEDS = [1, 2, 4, 6];
const PIXEL_FONT = "'Press Start 2P', monospace";

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ReplayBar({ controller }: ReplayBarProps) {
  const [playing, setPlaying] = useState(controller.isPlaying);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(controller.duration);
  const [speed, setSpeed] = useState(controller.currentSpeed);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTotal(controller.duration);
    controller.onProgress = (elapsed, dur) => {
      setProgress(elapsed);
      setTotal(dur);
      setPlaying(controller.isPlaying);
    };
    return () => { controller.onProgress = null; };
  }, [controller]);

  const togglePlay = useCallback(() => {
    if (controller.isPlaying) {
      controller.pause();
      setPlaying(false);
    } else {
      controller.resume();
      setPlaying(true);
    }
  }, [controller]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    controller.setSpeed(next);
  }, [controller, speed]);

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    controller.seek(frac * total);
    setProgress(frac * total);
  }, [controller, total]);

  const fraction = total > 0 ? progress / total : 0;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 pointer-events-auto bg-gray-900/90 border-t border-gray-700 px-4 py-2 flex items-center gap-3"
      style={{ fontFamily: PIXEL_FONT, fontSize: '7px' }}
    >
      {/* Play/Pause */}
      <button onClick={togglePlay} className="text-amber-400 hover:text-amber-300 text-sm">
        {playing ? '⏸' : '▶'}
      </button>

      {/* Speed */}
      <button onClick={cycleSpeed} className="text-gray-400 hover:text-gray-200 min-w-8">
        {speed}×
      </button>

      {/* Timeline bar */}
      <div
        ref={barRef}
        className="flex-1 h-2 bg-gray-800 rounded cursor-pointer relative"
        onClick={handleBarClick}
      >
        <div
          className="h-full bg-amber-400/70 rounded"
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-amber-400 rounded-full shadow"
          style={{ left: `calc(${fraction * 100}% - 4px)` }}
        />
      </div>

      {/* Time */}
      <span className="text-gray-400 min-w-16 text-right">
        {formatTime(progress)} / {formatTime(total)}
      </span>
    </div>
  );
}
