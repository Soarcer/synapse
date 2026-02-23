// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── OpenClaw Plugin Types ──────────────────────────────────────────

/** Configuration validated by TypeBox schema */
export interface SynapseConfig {
  port: number;
  dbPath?: string;
  layers: {
    transcriptWatcher: boolean;
    agentTools: boolean;
    providerWrapper: boolean;
  };
  wrappedProviders: string[];
  watchPaths: string[];
}

/** OpenClaw plugin dependency injection */
export interface PluginDeps {
  logger: PluginLogger;
  configDir: string;
  workspaceDir: string;
  rpc: unknown;
}

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** OpenClaw tool definition returned from plugin init */
export interface OpenClawTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<unknown>;
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

/** Model pricing per 1M tokens */
export interface ModelPricing {
  input: number;
  output: number;
}
