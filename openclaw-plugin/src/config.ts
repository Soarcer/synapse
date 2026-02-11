import { Type, type Static } from '@sinclair/typebox';

export const SynapseConfigSchema = Type.Object({
  port: Type.Number({ default: 4000, description: 'Dashboard server port' }),
  dbPath: Type.Optional(Type.String({ description: 'SQLite database path (default: plugin data dir)' })),
  layers: Type.Object({
    transcriptWatcher: Type.Boolean({ default: true, description: 'Watch JSONL transcripts for events' }),
    agentTools: Type.Boolean({ default: true, description: 'Register synapse_query/metrics/dashboard tools' }),
    providerWrapper: Type.Boolean({ default: false, description: 'Wrap providers for deep monitoring' }),
  }),
  wrappedProviders: Type.Array(Type.String(), {
    default: [],
    description: 'Provider IDs to wrap (e.g., ["anthropic", "openai"]). Only used when providerWrapper is true.',
  }),
  watchPaths: Type.Array(Type.String(), {
    default: [],
    description: 'Additional directories to watch for JSONL transcripts. Empty = auto-discover from configDir.',
  }),
});

export type SynapseConfigType = Static<typeof SynapseConfigSchema>;
