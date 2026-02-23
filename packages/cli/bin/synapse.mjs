#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Thin entry point — delegates to the compiled CLI.
// When installed via npm, dist/ is pre-built.
// When developing locally, run `npx tsx src/cli.ts` instead.

import('../dist/cli.mjs');
