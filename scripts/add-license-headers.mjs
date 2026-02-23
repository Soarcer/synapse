#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/**
 * Adds SPDX license headers to all TypeScript/JavaScript source files.
 *
 * Usage:
 *   node scripts/add-license-headers.mjs          # dry-run (default)
 *   node scripts/add-license-headers.mjs --write   # actually modify files
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { globSync } from "node:fs";

// Use a simple recursive glob since Node 22+ has fs.globSync
// For Node 20 compatibility, implement manually
import { readdirSync, statSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");

const AGPL_HEADER = `// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
`;

const EE_HEADER = `// SPDX-License-Identifier: LicenseRef-Synapse-Enterprise
// Copyright (c) 2026 Synapse Contributors
// See /ee/LICENSE for terms
`;

const DIRS = [
  "packages/core/src",
  "packages/server/src",
  "packages/openclaw/src",
  "apps/dashboard/src",
  "apps/vscode/src",
];

const SINGLE_FILES = ["hooks/send_event.cjs"];

const EXTENSIONS = new Set([".ts", ".tsx", ".cjs", ".mjs"]);

function walk(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "out") continue;
      results.push(...walk(full));
    } else if (EXTENSIONS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

function needsHeader(content) {
  // Already has a header (with or without leading shebang)
  const withoutShebang = content.startsWith("#!") ? content.slice(content.indexOf("\n") + 1) : content;
  return !withoutShebang.startsWith("// SPDX-License-Identifier:");
}

function getHeader(filePath) {
  const rel = relative(ROOT, filePath).replace(/\\/g, "/");
  if (rel.startsWith("ee/")) return EE_HEADER;
  return AGPL_HEADER;
}

function addHeader(content, header) {
  // Preserve shebang on line 1 if present
  if (content.startsWith("#!")) {
    const newlineIdx = content.indexOf("\n");
    const shebang = content.slice(0, newlineIdx + 1);
    const rest = content.slice(newlineIdx + 1);
    return shebang + header + "\n" + rest;
  }
  return header + "\n" + content;
}

function main() {
  const dryRun = !process.argv.includes("--write");

  if (dryRun) {
    console.log("DRY RUN — pass --write to actually modify files\n");
  }

  const files = [];

  for (const dir of DIRS) {
    const absDir = resolve(ROOT, dir);
    files.push(...walk(absDir));
  }

  for (const f of SINGLE_FILES) {
    const absFile = resolve(ROOT, f);
    try {
      statSync(absFile);
      files.push(absFile);
    } catch {
      // file doesn't exist, skip
    }
  }

  let modified = 0;
  let skipped = 0;

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    if (!needsHeader(content)) {
      skipped++;
      continue;
    }

    const header = getHeader(file);
    const newContent = addHeader(content, header);

    if (dryRun) {
      console.log(`  would add header: ${rel}`);
    } else {
      writeFileSync(file, newContent, "utf-8");
      console.log(`  added header: ${rel}`);
    }
    modified++;
  }

  console.log(
    `\n${dryRun ? "Would modify" : "Modified"}: ${modified} files | Skipped (already has header): ${skipped}`,
  );
}

main();
