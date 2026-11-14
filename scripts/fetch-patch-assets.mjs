#!/usr/bin/env node
// Downloads the Patch (patch.gg) library assets used by the game through the
// official public API, verifies every file's SHA-256, and writes
//   public/assets/patch/manifest.json  (runtime lookup: key -> files + credit)
//   ASSET_CREDITS.md                   (license + credit lines, CC-BY duties)
//
// Usage: npm run assets            (re-run safe: verified files are skipped)
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://patch.gg/api/v1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets', 'patch');

/** key: how the game refers to it. variant: Patch variant name. roles: which files to keep. */
export const ASSETS = [
  { key: 'jetPlayer', id: 'scenario:asset_AFJ7WNJT3rSULDLBwTXmqD7U', variant: 'web-lod1', use: 'Player fighter jet' },
  { key: 'jetEnemy', id: 'scenario:asset_AFJ7WNJT3rSULDLBwTXmqD7U', variant: 'web-lod2', use: 'Enemy fighter jets' },
  { key: 'propEnemy', id: 'scenario:12162a48873f808d', variant: 'web-lod1', use: 'Enemy propeller fighters (bandits)' },
  { key: 'coast', id: 'polyhaven:coast_line_01', variant: 'web-lod2', use: 'Photogrammetry rocky shoreline set dressing' },
  { key: 'sky', id: 'polyhaven:kloofendal_43d_clear_puresky', variant: 'web', roles: ['environment', 'background'], use: 'Sky background + image based lighting' },
  { key: 'matGrass', id: 'polyhaven:aerial_grass_rock', variant: 'web', roles: ['baseColor', 'normal', 'arm'], use: 'Terrain: grass/rock layer' },
  { key: 'matRock', id: 'polyhaven:aerial_rocks_02', variant: 'web', roles: ['baseColor', 'normal', 'arm'], use: 'Terrain: mountain rock layer' },
  { key: 'matSand', id: 'polyhaven:aerial_beach_01', variant: 'web', roles: ['baseColor', 'normal', 'arm'], use: 'Terrain: beach layer' },
];

const safe = (id) => id.replace(/[^a-zA-Z0-9_-]+/g, '_');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function withRetry(label, fn, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      console.warn(`  ! ${label} attempt ${i}/${tries} failed: ${err.message}`);
    }
  }
  throw last;
}

async function getJson(url) {
  return withRetry(url, async () => {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'skyward-asset-fetch/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  });
}

const PART = 1 << 20; // 1 MiB ranges
const PARALLEL = 10;

/** Downloads with parallel 1 MiB Range requests (the CDN throttles per connection). */
async function fetchBuffer(url, expectedSize) {
  if (!expectedSize || expectedSize < PART * 2) return fetchStream(url, expectedSize);
  const parts = [];
  for (let start = 0; start < expectedSize; start += PART) parts.push([start, Math.min(expectedSize, start + PART) - 1]);
  const out = new Array(parts.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < parts.length) {
      const i = next++;
      const [a, b] = parts[i];
      out[i] = await withRetry(`${url} [${a}-${b}]`, async () => {
        const res = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(90000) });
        if (res.status !== 206 && !(res.status === 200 && parts.length === 1)) throw new Error(`HTTP ${res.status} for range`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== b - a + 1) throw new Error(`range length ${buf.length} != ${b - a + 1}`);
        return buf;
      }, 4);
      done++;
      if (done % 4 === 0 || done === parts.length) process.stdout.write(`    ${done}/${parts.length} parts\r`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, parts.length) }, worker));
  process.stdout.write('\n');
  return Buffer.concat(out);
}

/** Streams a small file with an idle timeout (stalled body aborts). */
async function fetchStream(url, expectedSize) {
  return withRetry(url, async () => {
    const ctrl = new AbortController();
    let idle = setTimeout(() => ctrl.abort(new Error('stalled 30s')), 30000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
      const chunks = [];
      let got = 0, lastPct = -10;
      for await (const chunk of res.body) {
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(new Error('stalled 30s')), 30000);
        chunks.push(chunk);
        got += chunk.length;
        const pct = expectedSize ? Math.floor((got / expectedSize) * 100) : 0;
        if (pct >= lastPct + 25) { lastPct = pct; process.stdout.write(`    ${pct}% `); }
      }
      process.stdout.write('\n');
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } finally {
      clearTimeout(idle);
    }
  });
}

async function fileMatches(path, hash) {
  try {
    await stat(path);
    return sha256(await readFile(path)) === hash;
  } catch {
    return false;
  }
}

async function download(file, dest) {
  if (await fileMatches(dest, file.sha256)) return 'cached';
  console.log(`  -> ${file.name} (${(file.size / 1e6).toFixed(2)} MB)`);
  const buf = await fetchBuffer(file.url, file.size);
  const got = sha256(buf);
  if (got !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.name}: expected ${file.sha256}, got ${got}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return `downloaded ${(buf.length / 1e6).toFixed(2)} MB`;
}

async function main() {
  const manifest = { generated: new Date().toISOString(), source: API, assets: {} };
  const credits = new Map();
  const details = new Map();

  // --skip key1,key2 : record the asset in the manifest but don't download it
  const skipArg = process.argv.find((a) => a.startsWith('--skip='));
  const skip = new Set(skipArg ? skipArg.slice(7).split(',') : []);
  for (const spec of ASSETS) {
    let asset = details.get(spec.id);
    if (!asset) {
      asset = await getJson(`${API}/assets/${encodeURIComponent(spec.id)}`);
      details.set(spec.id, asset);
    }
    const variant = asset.variants.find((v) => v.name === spec.variant);
    if (!variant) throw new Error(`${spec.id} has no variant ${spec.variant} (has ${asset.variants.map((v) => v.name).join(', ')})`);
    const files = {};
    for (const f of variant.files) {
      if (spec.roles && !spec.roles.includes(f.role)) continue;
      const rel = `${safe(spec.id)}/${spec.variant}/${f.name}`;
      const dest = join(OUT, rel);
      const status = skip.has(spec.key)
        ? ((await fileMatches(dest, f.sha256)) ? 'present' : 'SKIPPED (not yet present)')
        : await download(f, dest);
      console.log(`[${spec.key}] ${f.role.padEnd(11)} ${rel}  (${status})`);
      files[f.role] = `assets/patch/${rel}`;
      // keep an integrity record next to the manifest
      files[`${f.role}Sha256`] = f.sha256;
    }
    manifest.assets[spec.key] = {
      id: spec.id,
      title: asset.title,
      variant: spec.variant,
      type: asset.type,
      license: asset.license?.spdx,
      licenseUrl: asset.license?.url,
      ai: !!asset.ai,
      facts: variant.facts || {},
      dims: asset.facts?.dims_m || null,
      files,
    };
    if (!credits.has(spec.id)) credits.set(spec.id, { asset, uses: [] });
    credits.get(spec.id).uses.push(`${spec.use} (variant \`${spec.variant}\`)`);
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Credits markdown
  let md = `# Asset Credits\n\nAll third-party 3D models, HDRIs and materials were obtained from the [Patch](https://patch.gg) asset library through its public API (\`${API}\`) by \`scripts/fetch-patch-assets.mjs\`. Every file is verified against the SHA-256 published by Patch. Patch's \`credit\` line is reproduced verbatim for each asset.\n\n`;
  md += `## Changes made in this game (CC BY 4.0 "indicate changes")\n\nModels are loaded unmodified from the downloaded GLB files; at runtime the game rescales them, recolours material tints for team identification (enemy livery), and re-orients them to the flight model axes. Terrain textures are tiled and blended by height/slope in a custom shader.\n\nNo endorsement by the creators, Scenario, Poly Haven or Patch is implied.\n\n`;
  for (const { asset, uses } of credits.values()) {
    md += `### ${asset.title} — \`${asset.id}\`\n\n`;
    md += `- License: [${asset.license?.name || asset.license?.spdx}](${asset.license?.url}) (${asset.license?.spdx})\n`;
    md += `- Source: ${asset.source?.name || ''} ${asset.source?.url ? `<${asset.source.url}>` : ''}\n`;
    if (asset.ai) md += `- AI-generated: yes${asset.generated_by ? ` (${asset.generated_by})` : ''}\n`;
    if (asset.license?.duties?.length) md += `- License duties: ${asset.license.duties.join(', ')}\n`;
    md += `- Used for: ${uses.join('; ')}\n`;
    md += `- Credit line: ${asset.credit}\n\n`;
  }
  md += `## Code\n\nThree.js (MIT) — https://threejs.org\n`;
  await writeFile(join(ROOT, 'ASSET_CREDITS.md'), md);

  // Licence texts + CREDITS.md shipped inside the release (public/ is copied to dist/)
  const spdxs = new Set([...credits.values()].map(({ asset }) => asset.license?.spdx).filter(Boolean));
  await mkdir(join(ROOT, 'public', 'LICENSES'), { recursive: true });
  for (const spdx of spdxs) {
    const lic = await getJson(`${API}/assets/licenses/${encodeURIComponent(spdx)}`);
    const text = lic.text || lic.full_text || lic.license?.text || JSON.stringify(lic, null, 2);
    await writeFile(join(ROOT, 'public', 'LICENSES', `${spdx}.txt`), `${lic.name || spdx}\n${lic.url || ''}\n\n${text}\n`);
  }
  await writeFile(join(ROOT, 'public', 'CREDITS.md'), md);
  const recipeCredits = [...credits.values()].map(({ asset }) => asset.credit);
  await writeFile(join(OUT, 'recipe-credits.json'), JSON.stringify(recipeCredits, null, 2));

  // short credits for the in-game credits panel
  const short = [...credits.values()].map(({ asset }) => ({
    title: asset.title,
    by: (asset.creators || []).join(', ') || asset.source?.name,
    source: asset.source?.name,
    license: asset.license?.spdx,
    licenseUrl: asset.license?.url,
    url: asset.source?.url,
    ai: !!asset.ai,
  }));
  await writeFile(join(OUT, 'credits.json'), JSON.stringify(short, null, 2));
  console.log(`\nWrote ${join(OUT, 'manifest.json')} and ASSET_CREDITS.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
