// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @synapse-ai/core — shared types, validation schemas, and utilities

// Types
export type {
  AgentEventType,
  AgentEvent,
  SessionData,
  AgentNodeData,
  ToolCallSummary,
  UserPromptData,
  SpawnAgentRequest,
  McpServerConfig,
  WsServerMessage,
  WsClientMessage,
  ActiveAgentInfo,
} from './types/agent.js';

export type {
  TranscriptTurn,
  ModelUsage,
  TranscriptSummary,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  ContentBlock,
  ExtendedUsage,
  ConversationRecord,
  BashProgressRecord,
  AgentProgressRecord,
  HookProgressRecord,
  ProgressRecord,
  CompactBoundaryRecord,
  StopHookSummaryRecord,
  SystemRecord,
  FileChange,
  FileHistoryRecord,
  QueueOperationRecord,
  FullTranscript,
  StructuredThinking,
  ReasoningToolCall,
  ReasoningTurn,
  ReasoningData,
} from './types/transcript.js';

export type {
  CoachingDimension,
  DetectorResult,
  DimensionScore,
  ReportCard,
  NudgeSeverity,
  NudgeRuleCategory,
  NudgeRuleMeta,
  CoachingNudge,
  NudgeCandidate,
  SessionAccumulator,
  DeliveryConfig,
  PlaybookCategory,
  PlaybookPattern,
  Playbook,
  PromptAnalysis,
  SessionSummary,
  EnrichedNudge,
  AiCoachStatus,
} from './types/coaching.js';

// Transcript constants
export { MODEL_PRICING, DEFAULT_PRICING } from './types/transcript.js';

// Validation schemas
export {
  AgentEventSchema,
  SpawnAgentRequestSchema,
  SendMessageSchema,
  EventQuerySchema,
  SnapshotImportSchema,
  AnalyticsQuerySchema,
  PriceCreateSchema,
  CoachingQuerySchema,
  CoachingMultiQuerySchema,
  PlaybookCreateSchema,
  NudgeDismissSchema,
} from './schemas.js';

// Format utilities
export {
  formatTokens,
  formatElapsed,
  formatCount,
  formatDuration,
  formatRelativeTime,
  formatTime,
  statusIcon,
  PALETTES,
  KIND_COLORS,
  KIND_ICONS,
  getToolIcon,
  getKindColor,
  VENDOR_COLORS,
  getVendorColor,
  inferVendor,
  statusBorderColor,
  TYPE_COLORS,
  getTypeColor,
  normalizeCwd,
} from './utils/format.js';

export type { ColorPalette } from './utils/format.js';
