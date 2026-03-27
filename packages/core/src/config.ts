// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Single source of truth for Synapse network configuration.
 * Server-side / build-time only — do NOT import from browser code.
 * All port/TLS constants derived from at most 3 env vars.
 */

/** Parse and validate a port string. Throws on invalid/privileged ports. */
function parseAndValidatePort(raw: string): number {
  const port = parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1024 || port > 65533) {
    throw new Error(`Invalid SYNAPSE_PORT="${raw}". Must be 1024–65533 (need +2 headroom).`);
  }
  return port;
}

/** Base port — all service ports derive from this. */
export const SYNAPSE_PORT = parseAndValidatePort(process.env.SYNAPSE_PORT || '27246');

/** Hook server port (PermissionRequest blocking endpoint). */
export const HOOK_PORT = SYNAPSE_PORT + 1;

/** HTTP fallback for mobile Safari (only used when TLS enabled). */
export const HTTP_FALLBACK_PORT = SYNAPSE_PORT + 2;

/** Vite dev server port (only relevant in development). */
export const DEV_PORT = parseAndValidatePort(process.env.VITE_DEV_PORT || '5173');

/** Whether TLS is configured. Both cert and key must be set. */
export const USE_TLS = !!(process.env.SYNAPSE_TLS_CERT && process.env.SYNAPSE_TLS_KEY);

/** Protocol string for URL construction. */
export const PROTOCOL = USE_TLS ? 'https' : 'http';

/** WebSocket protocol string. */
export const WS_PROTOCOL = USE_TLS ? 'wss' : 'ws';
