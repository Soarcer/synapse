// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── OpenClaw Plugin Types ──────────────────────────────────────────

/** Plugin configuration (validated by JSON Schema in openclaw.plugin.json) */
export interface SynapseConfig {
  port: number;
  serverPath?: string;
  dbPath?: string;
  layers: {
    transcriptWatcher: boolean;
    agentTools: boolean;
    providerWrapper: boolean;
  };
  wrappedProviders: string[];
  watchPaths: string[];
}

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** OpenClaw JSONL transcript line (approximate schema) */
export interface TranscriptLine {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | TranscriptContentBlock[];
  model?: string;
  timestamp?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  tool_use_id?: string;
  stop_reason?: string;
}

export interface TranscriptContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}

/** Model pricing shape (used by ProviderWrapper) */
export interface ModelPricing {
  input: number;
  output: number;
}
