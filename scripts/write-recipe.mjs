#!/usr/bin/env node
// Writes patch-recipe.draft.json (DRAFT Patch release recipe; not pch project config): test checks reported by the game
// under ?patch-test=1, and per-asset credits generated from the asset manifest.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'public/assets/patch/manifest.json'), 'utf8'));
const shortCredits = JSON.parse(await readFile(join(ROOT, 'public/assets/patch/credits.json'), 'utf8'));
const byTitle = new Map(shortCredits.map((c) => [c.title, c]));

const seen = new Set();
const credits = [];
for (const a of Object.values(manifest.assets)) {
  const folder = Object.values(a.files).find((f) => typeof f === 'string' && f.startsWith('assets/'));
  if (!folder) continue;
  const dir = folder.split('/').slice(0, 3).join('/') + '/'; // assets/patch/<asset>/
  if (seen.has(dir)) continue;
  seen.add(dir);
  const c = byTitle.get(a.title) || {};
  credits.push({ files: dir, license: a.license, ...(c.url ? { source: c.url } : {}), ...(c.by ? { author: c.by } : {}) });
}

const recipe = {
  $schema: 'https://patch.gg/schemas/recipe/v1.json',
  test: {
    checks: ['assets-loaded', 'scene-rendered', 'hud-updated', 'wave-started', 'cannon-fired', 'enemy-hit', 'missile-launched', 'enemy-destroyed'],
    move_keys: ['KeyW', 'ArrowUp'],
  },
  credits,
};
await writeFile(join(ROOT, 'patch-recipe.draft.json'), JSON.stringify(recipe, null, 2) + '\n');
console.log(`patch-recipe.draft.json written with ${credits.length} credits`);
