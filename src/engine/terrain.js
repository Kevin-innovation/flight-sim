// Procedural island terrain. Pure functions so physics, AI and tests share the
// exact same ground the renderer draws.
import { smoothstep } from './util.js';

export const SEA_LEVEL = 0;
/** Soft combat boundary (m from origin). Beyond it the player takes damage. */
export const ARENA_RADIUS = 4200;
export const ARENA_WARN_RADIUS = 3600;
/** Half-size of the terrain mesh square. Outside of it is open ocean. */
export const TERRAIN_HALF = 3200;

export const ISLANDS = [
  { x: 0, z: 0, r: 1350, h: 230 }, // Iron Horizon main island
  { x: 1900, z: -1500, r: 650, h: 150 },
  { x: -1850, z: 1150, r: 780, h: 175 },
  { x: -1300, z: -2050, r: 420, h: 95 },
  { x: 1650, z: 1700, r: 480, h: 120 },
];

/** Runway on the main island (flat strip), axis along Z. */
export const RUNWAY = { x: -260, z: 160, halfLength: 420, halfWidth: 26, height: 14 };

// --- value noise --------------------------------------------------------
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, octaves = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // [0,1]
}

/**
 * Terrain height in metres at world (x, z). Values below SEA_LEVEL are seabed.
 */
export function heightAt(x, z) {
  let h = -60; // open sea floor
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const dx = x - isl.x, dz = z - isl.z;
    // wobble the coastline with noise so islands are not perfect circles
    const d = Math.sqrt(dx * dx + dz * dz) / isl.r;
    const wobble = (fbm(x * 0.0016 + i * 7.1, z * 0.0016 - i * 3.3, 3) - 0.5) * 0.55;
    const mask = 1 - smoothstep(0.35, 1.0, d + wobble);
    if (mask <= 0) continue;
    const ridge = fbm(x * 0.0024 + i * 11.7, z * 0.0024 + i * 5.9, 5);
    const peak = Math.pow(mask, 1.6);
    const ih = -35 + mask * 45 + peak * isl.h * (0.45 + ridge * 0.9);
    if (ih > h) h = ih;
  }
  // flatten the runway area
  const rx = Math.abs(x - RUNWAY.x), rz = Math.abs(z - RUNWAY.z);
  const rw = 1 - smoothstep(RUNWAY.halfWidth, RUNWAY.halfWidth + 90, rx);
  const rl = 1 - smoothstep(RUNWAY.halfLength, RUNWAY.halfLength + 160, rz);
  const flat = rw * rl;
  if (flat > 0) h = h + (RUNWAY.height - h) * flat;
  return h;
}

/** Height of the collidable surface (terrain or sea surface). */
export function surfaceHeightAt(x, z) {
  const h = heightAt(x, z);
  return h > SEA_LEVEL ? h : SEA_LEVEL;
}
