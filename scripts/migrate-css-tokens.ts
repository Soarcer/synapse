/**
 * CSS Token Migration Script
 * Replaces hardcoded hex Tailwind arbitrary values with semantic tokens.
 * Run: npx tsx scripts/migrate-css-tokens.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Mapping from hex to token name (just the token, prefix handled dynamically)
const HEX_TO_TOKEN: Record<string, string> = {
  '0d1117': 'syn-bg-primary',
  '161b22': 'syn-bg-surface',
  '1c2128': 'syn-bg-elevated',
  '1c2333': 'syn-bg-overlay',
  '1a1d27': 'syn-bg-tool-group',
  '30363d': 'syn-border-primary',
  '21262d': 'syn-border-subtle',
  '484f58': 'syn-border-muted',
  '8b949e': 'syn-text-secondary',
  e6edf3: 'syn-text-primary',
  f0f6fc: 'syn-text-bright',
};

// Files to skip (intentional exceptions)
const SKIP_FILES = [
  'ExportDialog',
  'TourLauncher',
  'TourOverlay',
  'migrate-css-tokens', // this script itself
];

function shouldSkip(filePath: string): boolean {
  return SKIP_FILES.some((name) => filePath.includes(name));
}

/**
 * Replaces all `bg-[#XXXXXX]` (and with opacity like `bg-[#XXXXXX]/50`)
 * patterns with semantic token equivalents.
 * Also handles modifier prefixes: hover:, focus:, dark:, group-hover:, etc.
 */
function migrateContent(content: string, filePath: string): { result: string; count: number } {
  let result = content;
  let count = 0;

  for (const [hex, token] of Object.entries(HEX_TO_TOKEN)) {
    // Pattern: (optional-modifier:)(prefix-)([#HEX](/opacity)?)
    // Matches: bg-[#0d1117], hover:bg-[#0d1117], bg-[#0d1117]/50, hover:bg-[#0d1117]/50
    // Also matches text-, border-, ring-, etc. prefixes
    const prefixes = [
      'bg',
      'text',
      'border',
      'ring',
      'from',
      'via',
      'to',
      'fill',
      'stroke',
      'shadow',
      'outline',
      'placeholder',
      'caret',
      'divide',
    ];

    for (const prefix of prefixes) {
      // Regex: (possibly modifier like hover:)(prefix)-([#hex](/opacity)?)
      // We need to match the bracket syntax: prefix-[#HEX] optionally followed by /digits
      const hexUpper = hex.toUpperCase();
      // Match case-insensitively for the hex part
      const pattern = new RegExp(
        `((?:[a-zA-Z_-]+:)*)${prefix}-\\[#(?:${hex}|${hexUpper})\\](\\/[0-9]+)?`,
        'g',
      );

      result = result.replace(pattern, (match, modifiers, opacity) => {
        count++;
        const opacitySuffix = opacity || '';
        return `${modifiers}${prefix}-${token}${opacitySuffix}`;
      });
    }
  }

  return { result, count };
}

function findTsxFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function main() {
  const dashboardSrc = path.join(process.cwd(), 'apps', 'dashboard', 'src');
  const files = findTsxFiles(dashboardSrc);

  let totalFiles = 0;
  let totalReplacements = 0;
  const modifiedFiles: string[] = [];

  for (const filePath of files) {
    if (shouldSkip(filePath)) {
      console.log(`  SKIP: ${path.relative(process.cwd(), filePath)}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const { result, count } = migrateContent(content, filePath);

    if (count > 0) {
      fs.writeFileSync(filePath, result, 'utf8');
      const rel = path.relative(process.cwd(), filePath);
      console.log(`  MIGRATED (${count} replacements): ${rel}`);
      modifiedFiles.push(rel);
      totalFiles++;
      totalReplacements += count;
    }
  }

  console.log(
    `\n✓ Migration complete: ${totalReplacements} replacements across ${totalFiles} files`,
  );
  if (modifiedFiles.length > 0) {
    console.log('\nModified files:');
    modifiedFiles.forEach((f) => console.log(`  - ${f}`));
  }
}

main();
