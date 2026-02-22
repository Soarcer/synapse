// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/**
 * Inline SVG filter definitions for the gooey merge effect.
 * Renders a hidden <svg> with one <filter> per tool type so that
 * same-color blobs merge visually while different colors stay separate.
 *
 * Usage: <GooeyFilter id="goo-parentId" toolNames={['Read','Edit']} />
 * Then on wrapper divs: style={{ filter: `url(#goo-parentId-Read)` }}
 */
export function GooeyFilter({ id, toolNames }: { id: string; toolNames: string[] }) {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {toolNames.map((name) => (
          <filter key={name} id={`${id}-${name}`}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
