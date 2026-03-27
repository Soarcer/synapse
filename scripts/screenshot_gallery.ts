/**
 * Generates an index.html gallery page from screenshot output.
 * Displays all captured screenshots in a grid for visual QA.
 */

import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = path.join(process.cwd(), 'assets', 'screenshots');

interface Shot {
  name: string;
  category: string;
  pngPath: string;
}

export function generateGallery(): void {
  const categories = ['hero', 'lenses', 'features', 'mobile'];
  const shots: Shot[] = [];

  for (const cat of categories) {
    const dir = path.join(SCREENSHOT_DIR, cat);
    if (!fs.existsSync(dir)) continue;
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    for (const png of pngs) {
      shots.push({
        name: png.replace('.png', ''),
        category: cat,
        pngPath: `${cat}/${png}`,
      });
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synapse Screenshot QA Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e5e5e5; font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .meta { color: #888; font-size: 0.875rem; margin-bottom: 2rem; }
    h2 { font-size: 1.1rem; color: #60a5fa; margin: 2rem 0 1rem; text-transform: capitalize; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 1.5rem; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; display: block; cursor: zoom-in; }
    .card img:hover { opacity: 0.9; }
    .card .label { padding: 0.75rem 1rem; font-size: 0.8rem; color: #aaa; font-family: monospace; }
    .card .label code { color: #60a5fa; }
    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Synapse Screenshot QA Gallery</h1>
  <p class="meta">${shots.length} screenshots captured at ${new Date().toISOString()}</p>
  ${categories
    .filter((cat) => shots.some((s) => s.category === cat))
    .map(
      (cat) => `
  <h2>${cat} (${shots.filter((s) => s.category === cat).length})</h2>
  <div class="grid">
    ${shots
      .filter((s) => s.category === cat)
      .map(
        (s) => `
    <div class="card">
      <a href="${s.pngPath}" target="_blank"><img src="${s.pngPath}" alt="${s.name}" loading="lazy"></a>
      <div class="label"><code>${s.name}</code> · <a href="${s.pngPath}">PNG</a> · <a href="${s.pngPath.replace('.png', '.webp')}">WebP</a></div>
    </div>`,
      )
      .join('')}
  </div>`,
    )
    .join('')}
</body>
</html>`;

  const outPath = path.join(SCREENSHOT_DIR, 'index.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  console.log(`\x1b[32m✓\x1b[0m Gallery written to ${outPath}`);
}
