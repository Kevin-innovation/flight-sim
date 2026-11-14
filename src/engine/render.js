// Rendering building blocks: textured terrain, ocean shader, clouds,
// particle/billboard system, tracers and asset helpers.
import * as THREE from 'three';
import { heightAt, TERRAIN_HALF, SEA_LEVEL } from './terrain.js';
import { smoothstep, createRng } from './util.js';

// --------------------------------------------------------------- textures
export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft, lumpy cloud puff texture built from many blurred blobs. */
export function cloudTexture(seed = 3, size = 256) {
  const rng = createRng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * size * 0.26;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.75;
    const rad = size * (0.1 + rng() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const shade = 225 + Math.floor(rng() * 30);
    grd.addColorStop(0, `rgba(${shade},${shade},${shade + 3},0.42)`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- terrain
const terrainChunks = {
  vertexPars: /* glsl */ `attribute vec3 blend; varying vec3 vBlend; varying vec3 vWPos;`,
  vertex: /* glsl */ `vBlend = blend; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
  fragPars: /* glsl */ `
    uniform sampler2D tSand; uniform sampler2D tRock; uniform sampler2D tSandN; uniform sampler2D tRockN;
    varying vec3 vBlend; varying vec3 vWPos;
    vec4 tri3(sampler2D a, sampler2D b, sampler2D c, vec2 uv, vec3 w) {
      vec4 near = texture2D(a, uv * 1.3) * w.x + texture2D(b, uv) * w.y + texture2D(c, uv * 0.7) * w.z;
      vec4 far = texture2D(a, uv * 0.11) * w.x + texture2D(b, uv * 0.09) * w.y + texture2D(c, uv * 0.07) * w.z;
      return mix(near, far, 0.45);
    }`,
  map: /* glsl */ `
    #ifdef USE_MAP
      vec3 bw = vBlend / max(vBlend.x + vBlend.y + vBlend.z, 1e-3);
      vec4 tcol = tri3(tSand, map, tRock, vMapUv, bw);
      float wet = smoothstep(4.0, -2.0, vWPos.y);
      tcol.rgb *= mix(1.0, 0.55, wet);
      diffuseColor *= tcol;
    #endif`,
  normal: /* glsl */ `
    #ifdef USE_NORMALMAP_TANGENTSPACE
      vec3 bwn = vBlend / max(vBlend.x + vBlend.y + vBlend.z, 1e-3);
      vec3 mapN = (tri3(tSandN, normalMap, tRockN, vNormalMapUv, bwn).xyz) * 2.0 - 1.0;
      mapN.xy *= normalScale;
      normal = normalize( tbn * mapN );
    #endif`,
};

/**
 * Build the island terrain mesh. With `mats` (loaded PBR texture sets) it uses
 * a three-layer height/slope blended standard material; otherwise vertex colours.
 */
export function createTerrain({ segments = 300, mats = null } = {}) {
  const size = TERRAIN_HALF * 2;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x / 48, z / 48); // one texture tile ~48 m
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const blend = new Float32Array(pos.count * 3);
  const colors = new Float32Array(pos.count * 3);
  const rng = createRng(9);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    const n = (rng() - 0.5) * 0.15;
    const sand = 1 - smoothstep(6, 22, y + n * 40);
    const rock = Math.max(smoothstep(0.18, 0.42, slope + n), smoothstep(150, 240, y + n * 80));
    const grass = Math.max(0, 1 - sand - rock);
    blend[i * 3] = sand;
    blend[i * 3 + 1] = grass;
    blend[i * 3 + 2] = rock;
    // fallback vertex colours
    const c = new THREE.Color(0x5d7a3a).multiplyScalar(grass).add(new THREE.Color(0xc9b48a).multiplyScalar(sand)).add(new THREE.Color(0x6e6a64).multiplyScalar(rock));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('blend', new THREE.BufferAttribute(blend, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  let material;
  if (mats) {
    material = new THREE.MeshStandardMaterial({
      map: mats.grass.map,
      normalMap: mats.grass.normal,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.95,
      metalness: 0,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.tSand = { value: mats.sand.map };
      shader.uniforms.tRock = { value: mats.rock.map };
      shader.uniforms.tSandN = { value: mats.sand.normal };
      shader.uniforms.tRockN = { value: mats.rock.normal };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${terrainChunks.vertexPars}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${terrainChunks.vertex}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${terrainChunks.fragPars}`)
        .replace('#include <map_fragment>', terrainChunks.map)
        .replace('#include <normal_fragment_maps>', terrainChunks.normal);
    };
  } else {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = false;
  return mesh;
}

/** Load a Patch PBR material set (baseColor, normal) via the manifest entry. */
export async function loadMaterialSet(entry, anisotropy = 4) {
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) =>
    new Promise((res, rej) =>
      loader.load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      }, undefined, rej),
    );
  const [map, normal] = await Promise.all([load(entry.files.baseColor, true), load(entry.files.normal, false)]);
  return { map, normal };
}

// ------------------------------------------------------------------ ocean
export function createOcean({ envMap = null, sunDir, fog }) {
  // Height texture for shore depth/foam
  const N = 256;
  const data = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * TERRAIN_HALF * 2;
      const z = (j / (N - 1) - 0.5) * TERRAIN_HALF * 2;
      data[j * N + i] = Math.max(0, Math.min(255, Math.round(((heightAt(x, z) + 60) / 120) * 255)));
    }
  }
  const heightTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  const uniforms = {
    uTime: { value: 0 },
    uSun: { value: sunDir.clone() },
    uEnv: { value: envMap },
    uHasEnv: { value: envMap ? 1 : 0 },
    uHeight: { value: heightTex },
    uHalf: { value: TERRAIN_HALF },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform float uTime; uniform vec3 uSun; uniform sampler2D uEnv; uniform float uHasEnv;
      uniform sampler2D uHeight; uniform float uHalf; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vW;
      vec2 wave(vec2 p, vec2 d, float freq, float amp, float speed) {
        float ph = dot(p, d) * freq + uTime * speed;
        return d * cos(ph) * amp * freq;
      }
      vec3 skyColor(vec3 dir) {
        if (uHasEnv > 0.5) {
          vec2 uv = vec2(atan(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
          return texture2D(uEnv, uv).rgb;
        }
        return mix(vec3(0.55, 0.68, 0.82), vec3(0.18, 0.36, 0.62), clamp(dir.y * 2.0, 0.0, 1.0));
      }
      void main() {
        vec2 p = vW.xz;
        float dist = length(cameraPosition - vW);
        float detail = 1.0 - smoothstep(1500.0, 9000.0, dist);
        vec2 g = vec2(0.0);
        g += wave(p, normalize(vec2(1.0, 0.3)), 0.012, 1.4, 0.9);
        g += wave(p, normalize(vec2(-0.4, 1.0)), 0.021, 0.8, 1.3);
        g += wave(p, normalize(vec2(0.7, -0.8)), 0.047, 0.35, 1.9) * detail;
        g += wave(p, normalize(vec2(-0.9, -0.2)), 0.11, 0.14, 2.7) * detail;
        g += wave(p, normalize(vec2(0.2, 0.95)), 0.27, 0.05, 3.6) * detail;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vW);
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec2 huv = vW.xz / (uHalf * 2.0) + 0.5;
        float h = -60.0;
        if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) h = texture2D(uHeight, huv).r * 120.0 - 60.0;
        float depth = max(-h, 0.0);
        vec3 deep = vec3(0.006, 0.045, 0.085);
        vec3 shallow = vec3(0.03, 0.30, 0.33);
        vec3 water = mix(shallow, deep, smoothstep(2.0, 40.0, depth));
        float sunAmt = max(uSun.y, 0.0);
        water *= 0.55 + sunAmt * 0.8;
        vec3 col = mix(water, skyColor(r) * 0.9, fres);
        float spec = pow(max(dot(r, uSun), 0.0), 700.0) * 9.0 + pow(max(dot(r, uSun), 0.0), 60.0) * 0.25;
        col += vec3(1.0, 0.92, 0.8) * spec;
        float foamN = sin(p.x * 0.09 + uTime * 1.3) * sin(p.y * 0.083 - uTime * 1.1);
        float foam = (1.0 - smoothstep(0.0, 6.0 + foamN * 2.5, depth)) * step(-59.0, h);
        col = mix(col, vec3(0.92, 0.96, 0.97), foam * 0.75);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  return mesh;
}

// -------------------------------------------------- instanced billboards
const billboardVS = /* glsl */ `
  attribute vec3 iPos; attribute vec2 iSizeRot; attribute vec4 iColor;
  varying vec2 vUv; varying vec4 vColor; varying float vFog;
  uniform float uFogDensity;
  void main() {
    vUv = uv; vColor = iColor;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    mv.xy += q * iSizeRot.x;
    float d = -mv.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    gl_Position = projectionMatrix * mv;
  }`;
const billboardFS = /* glsl */ `
  uniform sampler2D uMap; uniform vec3 uFogColor; uniform float uFogAmt;
  varying vec2 vUv; varying vec4 vColor; varying float vFog;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    vec4 c = t * vColor;
    c.rgb = mix(c.rgb, uFogColor * c.a, vFog * uFogAmt);
    c.a *= 1.0 - vFog * (1.0 - uFogAmt) ;
    if (c.a < 0.003) discard;
    gl_FragColor = c;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class BillboardSet {
  constructor(capacity, map, { blending = THREE.NormalBlending, fog, fogAmt = 1 } = {}) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.pos = new Float32Array(capacity * 3);
    this.sizeRot = new Float32Array(capacity * 2);
    this.color = new Float32Array(capacity * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.sizeRot, 2).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSizeRot', this.aSize);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uFogColor: { value: fog ? fog.color : new THREE.Color() },
        uFogDensity: { value: fog ? fog.density : 0 },
        uFogAmt: { value: fogAmt },
      },
      vertexShader: billboardVS,
      fragmentShader: billboardFS,
      transparent: true,
      depthWrite: false,
      blending,
      premultipliedAlpha: blending === THREE.AdditiveBlending ? false : false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.count = 0;
  }
  begin() { this.count = 0; }
  push(x, y, z, size, rot, r, g, b, a) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.sizeRot[i * 2] = size; this.sizeRot[i * 2 + 1] = rot;
    this.color[i * 4] = r; this.color[i * 4 + 1] = g; this.color[i * 4 + 2] = b; this.color[i * 4 + 3] = a;
  }
  end() {
    this.geometry.instanceCount = this.count;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aColor.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.count * 3);
    this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, this.count * 2);
    this.aColor.clearUpdateRanges(); this.aColor.addUpdateRange(0, this.count * 4);
  }
}

/** Simple CPU particle pool rendered through a BillboardSet. */
export class Particles {
  constructor(capacity, map, opts) {
    this.set = new BillboardSet(capacity, map, opts);
    this.mesh = this.set.mesh;
    this.p = [];
    this.capacity = capacity;
  }
  spawn(o) {
    if (this.p.length >= this.capacity) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life || 1,
      s0: o.size || 1, s1: o.size1 ?? o.size ?? 1,
      c0: o.color || [1, 1, 1, 1], c1: o.color1 || o.color || [1, 1, 1, 0],
      drag: o.drag ?? 0.5, grav: o.grav ?? 0, rot: o.rot ?? Math.random() * 6.28, spin: o.spin ?? 0,
    });
  }
  update(dt) {
    const s = this.set;
    s.begin();
    const keep = [];
    for (const q of this.p) {
      q.life += dt;
      if (q.life >= q.max) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy = q.vy * k - q.grav * dt; q.vz *= k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      const t = q.life / q.max;
      const c0 = q.c0, c1 = q.c1;
      s.push(q.x, q.y, q.z, q.s0 + (q.s1 - q.s0) * t, q.rot,
        c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t);
      keep.push(q);
    }
    this.p = keep;
    s.end();
  }
  clear() { this.p.length = 0; this.set.begin(); this.set.end(); }
}

/** Static cloud field (one draw call). */
export function createClouds(fog, count = 70) {
  const tex = cloudTexture(5);
  const rng = createRng(77);
  const set = new BillboardSet(count * 9, tex, { fog, fogAmt: 1 });
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 600 + Math.sqrt(rng()) * 5200;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const cy = 900 + rng() * 900;
    const puffs = 5 + Math.floor(rng() * 5);
    const scale = 280 + rng() * 380;
    for (let j = 0; j < puffs; j++) {
      const b = 0.86 + rng() * 0.14;
      set.push(cx + (rng() - 0.5) * scale * 1.8, cy + (rng() - 0.3) * scale * 0.35, cz + (rng() - 0.5) * scale * 1.8,
        scale * (0.7 + rng() * 0.6), rng() * 6.28, b, b, b * 1.02, 0.75);
    }
  }
  set.end();
  return set;
}

// ------------------------------------------------------------------ tracers
export class Tracers {
  constructor(capacity = 700) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.mesh.frustumCulled = false;
  }
  update(bullets) {
    let n = 0;
    for (const b of bullets) {
      if (!b.active || n >= this.capacity) continue;
      const o = n * 6;
      this.positions[o] = b.pos.x; this.positions[o + 1] = b.pos.y; this.positions[o + 2] = b.pos.z;
      this.positions[o + 3] = b.pos.x - b.vel.x * 0.028; this.positions[o + 4] = b.pos.y - b.vel.y * 0.028; this.positions[o + 5] = b.pos.z - b.vel.z * 0.028;
      const c = b.team === 'player' ? [0.5, 1.6, 2.2] : [2.4, 0.9, 0.25];
      this.colors.set(c, o); this.colors.set([c[0] * 0.2, c[1] * 0.2, c[2] * 0.2], o + 3);
      n++;
    }
    this.mesh.geometry.setDrawRange(0, n * 2);
    this.aPos.needsUpdate = this.aCol.needsUpdate = true;
  }
}

// ----------------------------------------------------------- model helpers
/**
 * Source nose direction per asset, verified against real renders / node data:
 * - Patch convention (+Z front), e.g. the red vintage fighter: Engine/Cowling at +Z, tail gear at -Z.
 * - The orange fighter jet's nose is -X in its source file (gameplay screenshot showed it flying sideways).
 */
export const NOSE = {
  plusZ: { yaw: Math.PI, spanAxis: 'x', lengthAxis: 'z' },
  minusX: { yaw: -Math.PI / 2, spanAxis: 'z', lengthAxis: 'x' },
};

/**
 * Wrap a glTF scene so it is centred, scaled to `span` metres wingspan and
 * faces -Z (our flight model forward). `nose` says which way the source faces.
 */
export function normaliseAircraft(scene, span, nose = NOSE.plusZ) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = span / Math.max(size[nose.spanAxis], 1e-6);
  const inner = new THREE.Group();
  scene.position.sub(center);
  inner.add(scene);
  inner.scale.setScalar(s);
  inner.rotation.y = nose.yaw;
  const outer = new THREE.Group();
  outer.add(inner);
  outer.userData.length = size[nose.lengthAxis] * s;
  outer.userData.height = size.y * s;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.frustumCulled = true;
    }
  });
  return outer;
}

export function tintClone(template, tint, emissive) {
  const obj = template.clone(true);
  const mats = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map((m) => {
      const c = m.clone();
      if (tint && c.color) c.color.multiply(tint);
      if (c.emissive && emissive) c.emissive.copy(emissive);
      mats.push(c);
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  obj.userData.materials = mats;
  return obj;
}
