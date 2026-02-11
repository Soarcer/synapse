import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useAgentStore } from '../../store/agentStore';

interface Props {
  nodeId: string;
  position: Position;
  style?: React.CSSProperties;
  baseClassName: string;
}

function CollapsibleSourceHandleInner({ nodeId, position, style, baseClassName }: Props) {
  const hasChildren = useAgentStore((s) => s.edges.some((e) => e.source === nodeId));
  const isCollapsed = useAgentStore((s) => s.collapsedNodes.has(nodeId));
  const toggleCollapsed = useAgentStore((s) => s.toggleCollapsed);

  const childCount = useAgentStore((s) => {
    if (!isCollapsed) return 0;
    let count = 0;
    for (const e of s.edges) {
      if (e.source === nodeId) count++;
    }
    return count;
  });

  if (!hasChildren) {
    return (
      <Handle type="source" position={position} className={baseClassName} style={style} />
    );
  }

  return (
    <>
      <Handle
        type="source"
        position={position}
        className={
          isCollapsed
            ? '!bg-amber-400 !w-4 !h-4 !border-2 !border-amber-800 !cursor-pointer'
            : `${baseClassName} !cursor-pointer`
        }
        style={style}
        title={isCollapsed ? 'Click to expand children' : 'Click to collapse children'}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          toggleCollapsed(nodeId);
        }}
      />
      {isCollapsed && childCount > 0 && (
        <span
          className="absolute pointer-events-none text-[8px] font-bold text-amber-900 tabular-nums"
          style={
            position === Position.Right
              ? { right: -4, top: '50%', transform: 'translate(0, -50%)' }
              : { bottom: -4, left: (style?.left as number) ?? 12, transform: 'translate(-50%, 0)' }
          }
        >
          +{childCount}
        </span>
      )}
    </>
  );
}

export const CollapsibleSourceHandle = memo(CollapsibleSourceHandleInner);
