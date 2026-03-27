#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Thin entry point — delegates to the compiled CLI.
// When installed via npm, dist/ is pre-built.
// When developing locally, run `npx tsx src/cli.ts` instead.

import('../dist/cli.mjs');
