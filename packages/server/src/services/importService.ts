// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Import Service ─────────────────────────────────────────────────
// Handles importing usage data from various AI providers.

import { nanoid } from 'nanoid';
import { logger } from '../lib/logger.js';
import { insertEvent, updateDailyRollup } from '../db.js';
import {
  normalizeProviderEvent,
  normalizeCsvRow,
  type CsvUsageRow,
  type ProviderFormat,
} from './providerNormalizer.js';
import { computeCostUsd } from './costService.js';
import { normalizeCwd } from '@synapse-ai/core';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ─── CSV Import (OpenAI usage export format) ────────────────────────

export function importCsv(csvText: string, cwd?: string): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    result.errors.push('CSV must have a header row and at least one data row');
    return result;
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const modelIdx = header.indexOf('model');
  const inputIdx = header.findIndex((h) => h.includes('input') && h.includes('token'));
  const outputIdx = header.findIndex((h) => h.includes('output') && h.includes('token'));
  const requestsIdx = header.indexOf('requests');

  if (dateIdx === -1 || modelIdx === -1) {
    result.errors.push('CSV must have "date" and "model" columns');
    return result;
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    try {
      const row: CsvUsageRow = {
        date: cols[dateIdx],
        model: cols[modelIdx],
        input_tokens: inputIdx >= 0 ? parseInt(cols[inputIdx], 10) || 0 : 0,
        output_tokens: outputIdx >= 0 ? parseInt(cols[outputIdx], 10) || 0 : 0,
        requests: requestsIdx >= 0 ? parseInt(cols[requestsIdx], 10) || 1 : 1,
      };

      const event = normalizeCsvRow(row, `csv-import-${nanoid(8)}`);
      const costUsd = event.tokenUsage
        ? computeCostUsd(
            event.model || 'unknown',
            event.tokenUsage.input,
            event.tokenUsage.output,
            0,
            event.timestamp,
          )
        : 0;

      insertEvent({
        event_id: event.id,
        session_id: event.sessionId,
        hook_event_name: 'csv_import',
        event_type: event.type,
        vendor: event.vendor,
        token_input: event.tokenUsage?.input,
        token_output: event.tokenUsage?.output,
        cwd: cwd ? normalizeCwd(cwd) : null,
        raw_payload: JSON.stringify({ ...row, model: event.model }),
        created_at: event.timestamp,
      });

      updateDailyRollup({
        created_at: event.timestamp,
        cwd: cwd ? normalizeCwd(cwd) : undefined,
        model: event.model,
        vendor: event.vendor,
        event_type: event.type,
        token_input: event.tokenUsage?.input,
        token_output: event.tokenUsage?.output,
        cost_usd: costUsd,
      });

      result.imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Row ${i + 1}: ${msg}`);
      result.skipped++;
    }
  }

  logger.info({ imported: result.imported, skipped: result.skipped }, 'CSV import complete');
  return result;
}

// ─── JSON Import (generic or Gemini format) ─────────────────────────

export function importJson(
  data: unknown,
  providerHint?: ProviderFormat,
  cwd?: string,
): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  const items = Array.isArray(data) ? data : [data];

  for (let i = 0; i < items.length; i++) {
    try {
      const item = items[i] as Record<string, unknown>;
      const event = normalizeProviderEvent(item, undefined, providerHint);
      const costUsd = event.tokenUsage
        ? computeCostUsd(
            event.model || 'unknown',
            event.tokenUsage.input,
            event.tokenUsage.output,
            0,
            event.timestamp,
          )
        : 0;

      insertEvent({
        event_id: event.id,
        session_id: event.sessionId,
        hook_event_name: 'json_import',
        event_type: event.type,
        vendor: event.vendor,
        tool_name: event.toolName,
        tool_use_id: event.toolUseId,
        tool_input: event.toolInput ? JSON.stringify(event.toolInput) : null,
        token_input: event.tokenUsage?.input,
        token_output: event.tokenUsage?.output,
        cwd: cwd ? normalizeCwd(cwd) : null,
        raw_payload: JSON.stringify({ ...item, model: event.model }),
        created_at: event.timestamp,
      });

      updateDailyRollup({
        created_at: event.timestamp,
        cwd: cwd ? normalizeCwd(cwd) : undefined,
        model: event.model,
        vendor: event.vendor,
        event_type: event.type,
        token_input: event.tokenUsage?.input,
        token_output: event.tokenUsage?.output,
        tool_name: event.toolName,
        cost_usd: costUsd,
      });

      result.imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Item ${i}: ${msg}`);
      result.skipped++;
    }
  }

  logger.info(
    { imported: result.imported, skipped: result.skipped, provider: providerHint },
    'JSON import complete',
  );
  return result;
}
