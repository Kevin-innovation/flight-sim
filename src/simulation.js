// FlightSimulation: renders the GameCore world with Three.js using real Patch
// library assets (jets, HDRI sky, PBR terrain materials) and drives input,
// camera, effects, HUD overlay and throttled telemetry.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GameCore } from './engine/game.js';
import { InputManager } from './engine/input.js';
import { HudOverlay } from './engine/hud.js';
import { createTerrain, createOcean, createClouds, Particles, Tracers, radialTexture, normaliseAircraft, NOSE, tintClone, loadMaterialSet } from './engine/render.js';
import { damp, clamp, createRng } from './engine/util.js';
import { lookRotation } from './engine/camera.js';
import { ControlScheme, DEFAULT_SETTINGS, MODE_LABELS } from './engine/controls.js';
import { ISLANDS } from './engine/terrain.js';

const FIXED_DT = 1 / 60;
const TELEMETRY_MS = 100;
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

function readQuality() {
  const q = typeof window !== 'undefined' && window.patch && window.patch.quality;
  return q === 'low' || q === 'medium' ? q : 'high';
}

export class FlightSimulation {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(t: object) => void} onTelemetry  telemetry (~10 Hz) and `{event}` messages
   * @param {{audio?: object, testMode?: boolean, assetBase?: string}} options
   */
  constructor(canvas, onTelemetry = () => {}, options = {}) {
    this.canvas = canvas;
    this.onTelemetry = onTelemetry;
    this.audio = options.audio || null;
    this.testMode = !!options.testMode;
    this.assetBase = options.assetBase || './';
    this.quality = readQuality();
    this.core = new GameCore({ seed: options.seed || 1337 });
    this.input = new InputManager({ padEnabled: !this.testMode });
    this.running = false;
    this.paused = false;
    this.disposed = false;
    this.ready = false;
    this.cameraMode = 0; // 0 chase, 1 cockpit, 2 far chase
    this.shake = 0;
    this.lastTelemetry = 0;
    this.accum = 0;
    this.lastTime = 0;
    this.rng = createRng(4242);
    this.checks = new Set();
    this.entityViews = new Map();
    this.controls = new ControlScheme(options.controlSettings || DEFAULT_SETTINGS);

    this._setupRenderer();
    this._setupScene();
    this.hud = new HudOverlay(canvas.parentElement || document.body);
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas.parentElement);
    }
    this._onBlur = () => { if (this.running && !this.paused) this.emitEvent('pauseRequested', { reason: 'blur' }); };
    window.addEventListener('blur', this._onBlur);
    this._onVis = () => { if (document.hidden) this._onBlur(); };
    document.addEventListener('visibilitychange', this._onVis);
    if (window.patch && window.patch.addEventListener) {
      this._onQuality = () => this.setQuality(readQuality());
      window.patch.addEventListener('qualitychange', this._onQuality);
    }
    this._setupMouse();
    this._resize();
    this._loop = this._loop.bind(this);
    this.assetsReady = this._loadAssets();
    // Draw the world behind the title screen from the start.
    this._idleRaf = requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------ public API
  start() {
    if (this.disposed) return;
    this.core.reset();
    this._clearViews();
    this.running = true;
    this.paused = false;
    this.input.clear();
    this.controls.release();
    this.controls.zoom = 1;
    this.lastTime = performance.now();
    this.accum = 0;
    this.audio?.startEngine?.();
    this.emitEvent('started');
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.input.clear();
    this._releaseMouse();
    this.audio?.setPaused?.(true);
    this.emitEvent('paused');
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.input.clear();
    this.lastTime = performance.now();
    this.accum = 0;
    this.audio?.setPaused?.(false);
    this.emitEvent('resumed');
  }

  restart() {
    this.start();
  }

  setInput(action, value) {
    this.input.set(action, value);
  }

  // --------------------------------------------------------- control presets
  /** Apply {mode, sensitivity, invertY}; clears held keys/buttons and mouse delta. */
  setControlSettings(s) {
    const prev = this.controls.mode;
    const out = this.controls.setSettings(s);
    this.input.clear();
    if (prev !== out.mode) this._releaseMouse();
    this.emitEvent('controlsChanged', { ...out });
    return out;
  }

  getControlSettings() {
    return { ...this.controls.settings };
  }

  /** True while gameplay accepts weapon/mouse input. */
  isActivePlay() {
    return this.running && !this.paused && this.core.status === 'playing';
  }

  /** Same paths the DOM listeners use; exposed for browser verification. */
  mouseMove(dx, dy) {
    if (this.isActivePlay()) this.controls.mouseMove(dx, dy);
  }
  mouseButton(button, down) {
    if (!down) { this.controls.mouseUp(button); return 'ok'; }
    if (!this.isActivePlay()) return 'ignored';
    const r = this.controls.mouseDown(button);
    if (r === 'capture') this._captureMouse();
    return r;
  }
  mouseWheel(deltaY) {
    if (this.isActivePlay()) return this.controls.wheel(deltaY);
    return this.controls.zoom;
  }

  getDebugState() {
    const fl = this.core.player.flight;
    const c = this.controls;
    return {
      mode: c.mode,
      settings: { ...c.settings },
      captured: c.captured,
      pointerLocked: c.pointerLocked,
      zoom: c.zoom,
      aimDir: c.aimDir.toArray(),
      look: { ...c.look },
      heading: fl.getHeading(),
      forward: fl.getForward(new THREE.Vector3()).toArray(),
      camera: this.camera.position.toArray(),
      cameraForward: this.camera.getWorldDirection(new THREE.Vector3()).toArray(),
      cameraDistance: this.camera.position.distanceTo(fl.position),
      fireHeld: c.buttons.fire,
      lastControls: this._lastCtl ? { ...this._lastCtl } : null,
    };
  }

  _setupMouse() {
    const cv = this.canvas;
    const isMouse = (e) => !e.pointerType || e.pointerType === 'mouse';
    this._onPointerDown = (e) => {
      if (!isMouse(e) || !this.isActivePlay()) return;
      if (e.button === 1 || e.button === 2) e.preventDefault(); // no autoscroll / menu in play
      this.mouseButton(e.button, true);
    };
    this._onPointerUp = (e) => { if (isMouse(e)) this.controls.mouseUp(e.button); };
    this._onMouseMove = (e) => {
      if (!this.isActivePlay()) return;
      if (this.controls.pointerLocked) this.controls.mouseMove(e.movementX || 0, e.movementY || 0);
      else this.controls.cursorMove(e.clientX, e.clientY); // lock denied: absolute-position deltas
    };
    this._onWheel = (e) => {
      if (!this.isActivePlay()) return;
      e.preventDefault();
      this.controls.wheel(e.deltaY);
    };
    this._onContext = (e) => { if (this.isActivePlay()) e.preventDefault(); };
    this._onAux = (e) => { if (this.isActivePlay() && e.button === 1) e.preventDefault(); };
    this._onLockChange = () => {
      const locked = document.pointerLockElement === cv;
      if (locked) this.controls.setCaptured(true);
      else if (this.controls.pointerLocked) {
        this.controls.release();
        if (this.isActivePlay()) this.emitEvent('pauseRequested', { reason: 'pointerunlock' });
      }
    };
    this._onLockError = () => {
      // lock denied: fall back to plain mouse deltas without lock
      if (this._wantLock) this.controls.setCaptured(false);
      this._wantLock = false;
    };
    cv.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    document.addEventListener('mousemove', this._onMouseMove);
    cv.addEventListener('wheel', this._onWheel, { passive: false });
    cv.addEventListener('contextmenu', this._onContext);
    cv.addEventListener('auxclick', this._onAux);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
  }

  _captureMouse() {
    if (this.testMode) return; // never auto-lock under Patch's test
    this._wantLock = true;
    const cv = this.canvas;
    try {
      const p = cv.requestPointerLock ? cv.requestPointerLock() : null;
      if (p && typeof p.then === 'function') {
        p.then(() => { this._wantLock = false; }).catch(() => this._onLockError());
      } else if (!cv.requestPointerLock) this._onLockError();
    } catch {
      this._onLockError();
    }
  }

  _releaseMouse() {
    this.controls.release();
    this._wantLock = false;
    if (document.pointerLockElement === this.canvas) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  setQuality(q) {
    this.quality = q;
    this._resize();
    if (this.particlesBudget) this.particlesBudget = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this._idleRaf);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._onQuality) window.patch.removeEventListener('qualitychange', this._onQuality);
    this._ro?.disconnect();
    const cv = this.canvas;
    cv.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    cv.removeEventListener('wheel', this._onWheel);
    cv.removeEventListener('contextmenu', this._onContext);
    cv.removeEventListener('auxclick', this._onAux);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    this._releaseMouse();
    this.input.dispose();
    this.hud.dispose();
    this.audio?.stopEngine?.();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
    });
    this.envRT?.dispose();
    this.renderer.dispose();
  }

  emitEvent(event, data = {}) {
    try {
      this.onTelemetry({ event, ...data });
    } catch (e) {
      console.error(e);
    }
  }

  // ----------------------------------------------------------------- setup
  _setupRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.renderer = r;
  }

  _setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x8fb4d6);
    this.fog = new THREE.FogExp2(0xa9c4dc, 0.00011);
    scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(65, 1, 1, 60000);
    this.camera.position.set(0, 700, 3000);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x40525e, 0.7);
    scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(SUN_DIR).multiplyScalar(1000);
    scene.add(this.sun);
    this.flash = new THREE.PointLight(0xffa040, 0, 900, 1.6);
    scene.add(this.flash);

    // World (fallback materials until Patch textures arrive)
    this.terrain = createTerrain({ segments: this.quality === 'low' ? 160 : 260 });
    scene.add(this.terrain);
    this.ocean = createOcean({ sunDir: SUN_DIR, fog: this.fog });
    scene.add(this.ocean);
    this.clouds = createClouds(this.fog, this.quality === 'low' ? 35 : 70);
    scene.add(this.clouds.mesh);

    // Effects
    const fireTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,220,150,0.9)'], [0.6, 'rgba(255,120,30,0.35)'], [1, 'rgba(255,60,0,0)']]);
    const smokeTex = radialTexture([[0, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(230,230,230,0.35)'], [1, 'rgba(200,200,200,0)']]);
    const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(180,240,255,0.8)'], [1, 'rgba(60,160,255,0)']]);
    this.glowTex = glowTex;
    this.fire = new Particles(1800, fireTex, { blending: THREE.AdditiveBlending, fog: this.fog, fogAmt: 0 });
    this.smoke = new Particles(2400, smokeTex, { fog: this.fog });
    scene.add(this.smoke.mesh, this.fire.mesh);
    this.tracers = new Tracers(700);
    scene.add(this.tracers.mesh);
    this.particlesBudget = this.quality === 'low' ? 0.4 : this.quality === 'medium' ? 0.7 : 1;

    // Missile mesh template (small projectile body)
    const mg = new THREE.CylinderGeometry(0.18, 0.18, 3.2, 10);
    mg.rotateX(Math.PI / 2);
    this.missileGeo = mg;
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.6, roughness: 0.35 });
    this.missileViews = new Map();
  }

  async _loadAssets() {
    const base = this.assetBase;
    const progress = (label, p) => this.emitEvent('loading', { label, progress: p });
    let manifest;
    try {
      const res = await fetch(`${base}assets/patch/manifest.json`);
      manifest = (await res.json()).assets;
    } catch (e) {
      console.warn('Patch asset manifest missing', e);
      this.emitEvent('assetError', { message: 'manifest' });
      this.ready = true;
      this.emitEvent('ready', { assets: false });
      return;
    }
    const url = (p) => base + p;
    const tasks = [];
    let done = 0;
    const total = 6;
    const step = (label) => progress(label, ++done / total);

    // Sky HDRI -> background + IBL
    tasks.push((async () => {
      const hdr = await new HDRLoader().loadAsync(url(manifest.sky.files.environment));
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envRT = pmrem.fromEquirectangular(hdr);
      pmrem.dispose();
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.9;
      this.scene.background = hdr;
      this.scene.backgroundIntensity = 1.0;
      this.ocean.material.uniforms.uEnv.value = hdr;
      this.ocean.material.uniforms.uHasEnv.value = 1;
      step('하늘 HDRI');
    })().catch((e) => console.warn('sky failed', e)));

    // Terrain PBR materials
    tasks.push((async () => {
      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const [grass, rock, sand] = await Promise.all([
        loadMaterialSet({ files: manifest.matGrass.files }, aniso),
        loadMaterialSet({ files: manifest.matRock.files }, aniso),
        loadMaterialSet({ files: manifest.matSand.files }, aniso),
      ]);
      const old = this.terrain;
      this.terrain = createTerrain({ segments: this.quality === 'low' ? 160 : 260, mats: { grass, rock, sand } });
      this.scene.add(this.terrain);
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
      step('지형 재질');
    })().catch((e) => console.warn('terrain mats failed', e)));

    // Aircraft
    const gltf = new GLTFLoader();
    gltf.setMeshoptDecoder(MeshoptDecoder);
    const loadModel = async (key, span, label, nose) => {
      const g = await gltf.loadAsync(url(manifest[key].files.model));
      const m = normaliseAircraft(g.scene, span, nose);
      step(label);
      return m;
    };
    tasks.push(loadModel('jetPlayer', 11, '플레이어 전투기', NOSE.minusX).then((m) => { this.playerTemplate = m; this._rebuildPlayer(); }).catch((e) => console.warn('player jet failed', e)));
    tasks.push(loadModel('jetEnemy', 11, '적 전투기', NOSE.minusX).then((m) => {
      this.enemyJetTemplate = tintClone(m, new THREE.Color(0.42, 0.46, 0.52));
      this._clearViews(true);
    }).catch((e) => console.warn('enemy jet failed', e)));
    tasks.push(loadModel('propEnemy', 11, '적 프로펠러기', NOSE.plusZ).then((m) => {
      this.enemyPropTemplate = m;
      this._clearViews(true);
    }).catch((e) => console.warn('prop failed', e)));
    // Coastline photogrammetry dressing
    tasks.push((async () => {
      const g = await gltf.loadAsync(url(manifest.coast.files.model));
      this._placeCoast(g.scene);
      step('해안 암석');
    })().catch((e) => console.warn('coast failed', e)));

    await Promise.all(tasks);
    this.ready = true;
    const ok = !!this.playerTemplate;
    this.emitEvent('ready', { assets: ok });
    if (ok && this.testMode) this._check('assets-loaded');
  }

  _placeCoast(src) {
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    src.position.sub(center);
    src.position.y += size.y / 2;
    const group = new THREE.Group();
    const placements = [
      [ISLANDS[0], 0.2], [ISLANDS[0], 1.7], [ISLANDS[0], 3.4], [ISLANDS[0], 4.9],
      [ISLANDS[2], 0.9], [ISLANDS[2], 3.9], [ISLANDS[1], 2.2], [ISLANDS[4], 5.5],
    ];
    const target = 140; // metres across
    const s = target / Math.max(size.x, size.z, 1e-3);
    for (const [isl, ang] of placements) {
      const piece = new THREE.Group();
      piece.add(src.clone());
      piece.scale.setScalar(s * (0.8 + this.rng() * 0.5));
      // find the coastline along this bearing
      let r = isl.r * 0.4;
      for (; r < isl.r * 1.4; r += 10) {
        const x = isl.x + Math.cos(ang) * r, z = isl.z + Math.sin(ang) * r;
        if (this._height(x, z) < 1) break;
      }
      piece.position.set(isl.x + Math.cos(ang) * r, -size.y * s * 0.25, isl.z + Math.sin(ang) * r);
      piece.rotation.y = -ang + Math.PI / 2;
      group.add(piece);
    }
    this.scene.add(group);
  }

  _height(x, z) {
    return this.terrain.geometry ? heightCache(x, z) : 0;
  }

  // ----------------------------------------------------------- entity views
  _rebuildPlayer() {
    if (this.playerView) this.scene.remove(this.playerView);
    this.playerView = new THREE.Group();
    if (this.playerTemplate) this.playerView.add(this.playerTemplate.clone(true));
    // afterburner glow
    const glowMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0x9fe8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.burner = new THREE.Sprite(glowMat);
    const len = this.playerTemplate ? this.playerTemplate.userData.length : 12;
    this.burner.position.set(0, 0.4, len * 0.5);
    this.burner.scale.setScalar(3);
    this.playerView.add(this.burner);
    this.scene.add(this.playerView);
  }

  _makeEnemyView(e) {
    const tpl = e.kind === 'prop' ? this.enemyPropTemplate : this.enemyJetTemplate;
    let obj;
    if (tpl) obj = tintClone(tpl, null, new THREE.Color(0, 0, 0));
    else {
      obj = new THREE.Group(); // assets still loading: invisible until model arrives
      obj.userData.materials = [];
      obj.userData.placeholder = true;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.set(0, 0.3, (tpl ? tpl.userData.length : 10) * 0.5);
    glow.scale.setScalar(2.2);
    obj.add(glow);
    obj.userData.glow = glow;
    this.scene.add(obj);
    return obj;
  }

  _clearViews(onlyPlaceholders = false) {
    for (const [e, v] of this.entityViews) {
      if (onlyPlaceholders && !v.userData.placeholder) continue;
      this.scene.remove(v);
      this.entityViews.delete(e);
    }
    if (!onlyPlaceholders) {
      for (const v of this.missileViews.values()) this.scene.remove(v);
      this.missileViews.clear();
      this.fire.clear();
      this.smoke.clear();
    }
  }

  _syncViews(dt) {
    const core = this.core;
    const pl = core.player;
    if (this.playerView) {
      this.playerView.visible = pl.alive && this.cameraMode !== 1;
      this.playerView.position.copy(pl.flight.position);
      this.playerView.quaternion.copy(pl.flight.quaternion);
      const b = pl.flight.boosting ? 5.5 + Math.random() * 1.5 : 2.6 + Math.random() * 0.4;
      this.burner.scale.setScalar(b);
      this.burner.material.opacity = pl.flight.boosting ? 1 : 0.7;
    }
    for (const e of core.enemies) {
      let v = this.entityViews.get(e);
      if (!e.alive) {
        if (v) { this.scene.remove(v); this.entityViews.delete(e); }
        continue;
      }
      if (!v) { v = this._makeEnemyView(e); this.entityViews.set(e, v); }
      v.position.copy(e.flight.position);
      v.quaternion.copy(e.flight.quaternion);
      const f = e.hitFlash > 0 ? e.hitFlash * 6 : 0;
      for (const m of v.userData.materials) if (m.emissive) m.emissive.setRGB(f, f * 0.5, f * 0.1);
      v.userData.glow.scale.setScalar(e.flight.boosting ? 4 : 2.2);
      // smoke when damaged
      if (e.hp < e.maxHp * 0.5 && Math.random() < dt * 30 * this.particlesBudget) {
        this.smoke.spawn({ x: v.position.x, y: v.position.y, z: v.position.z, vy: 4, life: 2.2, size: 5, size1: 18, color: [0.15, 0.15, 0.16, 0.6], color1: [0.3, 0.3, 0.3, 0] });
      }
    }
    // remove views of removed enemies
    for (const [e, v] of this.entityViews) if (!core.enemies.includes(e)) { this.scene.remove(v); this.entityViews.delete(e); }

    // missiles
    const seen = new Set();
    for (const m of core.missiles) {
      if (!m.active) continue;
      seen.add(m.id);
      let v = this.missileViews.get(m.id);
      if (!v) {
        v = new THREE.Mesh(this.missileGeo, this.missileMat);
        const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: m.team === 'player' ? 0xbff4ff : 0xff8040, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.scale.setScalar(4);
        g.position.z = 1.8;
        v.add(g);
        this.scene.add(v);
        this.missileViews.set(m.id, v);
      }
      v.position.copy(m.pos);
      _v.copy(m.pos).add(m.vel);
      v.lookAt(_v);
      v.rotateY(Math.PI); // geometry forward is -Z after lookAt flip
      if (Math.random() < this.particlesBudget) {
        this.smoke.spawn({ x: m.pos.x, y: m.pos.y, z: m.pos.z, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, life: 2.6, size: 2.5, size1: 11, color: [0.92, 0.92, 0.94, 0.55], color1: [0.85, 0.85, 0.88, 0], drag: 1.2 });
      }
    }
    for (const [id, v] of this.missileViews) if (!seen.has(id)) { this.scene.remove(v); this.missileViews.delete(id); }
  }

  // --------------------------------------------------------------- effects
  _explosion(pos, size = 1, { water = false, debris = false } = {}) {
    const n = Math.round(26 * size * this.particlesBudget) + 6;
    for (let i = 0; i < n; i++) {
      const s = 1 + size * 6;
      this.fire.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (Math.random() - 0.5) * 60 * size, vy: (Math.random() - 0.4) * 60 * size, vz: (Math.random() - 0.5) * 60 * size,
        life: 0.5 + Math.random() * 0.7, size: s, size1: s * 3.2,
        color: [1.6, 1.1, 0.6, 1], color1: [0.9, 0.2, 0.05, 0], drag: 2.5,
      });
    }
    for (let i = 0; i < n * 0.8; i++) {
      this.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (Math.random() - 0.5) * 30 * size, vy: Math.random() * 20 * size, vz: (Math.random() - 0.5) * 30 * size,
        life: 2.5 + Math.random() * 2.5, size: 4 * size, size1: 26 * size,
        color: water ? [0.9, 0.93, 0.95, 0.7] : [0.12, 0.11, 0.1, 0.75], color1: water ? [0.9, 0.93, 0.95, 0] : [0.35, 0.33, 0.32, 0], drag: 1.4,
      });
    }
    if (debris) {
      for (let i = 0; i < 18 * this.particlesBudget; i++) {
        this.fire.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * 160, vy: Math.random() * 90, vz: (Math.random() - 0.5) * 160, life: 1.4 + Math.random(), size: 1.4, size1: 0.4, color: [2, 1.4, 0.6, 1], color1: [1, 0.3, 0.1, 0], drag: 0.4, grav: 30 });
      }
    }
    this.flash.position.copy(pos);
    this.flash.intensity = 4e5 * size;
    const d = pos.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, clamp((size * 900) / Math.max(d, 50), 0, 1.2));
  }

  _handleEvents(events) {
    const audio = this.audio;
    for (const ev of events) {
      switch (ev.type) {
        case 'explosion':
          this._explosion(ev.pos, ev.size, ev);
          audio?.play?.('explosion', { size: ev.size, distance: ev.pos.distanceTo(this.camera.position) });
          break;
        case 'hit':
          for (let i = 0; i < 5; i++) this.fire.spawn({ x: ev.pos.x, y: ev.pos.y, z: ev.pos.z, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, vz: (Math.random() - 0.5) * 50, life: 0.25, size: 1.5, size1: 0.3, color: [2, 1.6, 0.8, 1], color1: [1, 0.4, 0.1, 0], drag: 3 });
          audio?.play?.('hit');
          if (this.testMode) this._check('enemy-hit');
          break;
        case 'impact':
          this.smoke.spawn({ x: ev.pos.x, y: ev.pos.y + 1, z: ev.pos.z, vy: 8, life: 1.1, size: 2, size1: 7, color: ev.water ? [0.95, 0.97, 1, 0.8] : [0.45, 0.4, 0.35, 0.6], color1: [0.9, 0.9, 0.9, 0], drag: 2 });
          break;
        case 'playerHit':
          this.shake = Math.max(this.shake, 0.5);
          this.input.rumble(0.8, 0.4, 150);
          audio?.play?.('playerHit');
          break;
        case 'kill':
          this.emitEvent('kill', { callsign: ev.callsign, points: ev.points, combo: ev.combo });
          audio?.play?.('kill');
          if (this.testMode) this._check('enemy-destroyed');
          break;
        case 'missileLaunch':
          audio?.play?.('missile', { enemy: ev.team !== 'player' });
          if (ev.team === 'player' && this.testMode) this._check('missile-launched');
          break;
        case 'missileWarning':
          audio?.play?.('warning');
          break;
        case 'lock':
          audio?.play?.('lock');
          break;
        case 'gunFiring':
          if (ev.team === 'player') {
            this._playerFiring = true;
            if (this.testMode) this._check('cannon-fired');
          } else audio?.play?.('enemyGun', { distance: this._enemyDist(ev.id) });
          break;
        case 'waveStart':
          this.emitEvent('waveStart', { wave: ev.wave, name: ev.name, count: ev.count });
          audio?.play?.('wave');
          if (this.testMode) this._check('wave-started');
          break;
        case 'waveClear':
          this.emitEvent('waveClear', { wave: ev.wave, bonus: ev.bonus });
          break;
        case 'playerDown':
          this.input.rumble(1, 1, 400);
          this.emitEvent('playerDown', { reason: ev.reason });
          break;
        case 'gameover':
          this.emitEvent('gameover', { score: ev.score, reason: ev.reason });
          break;
        case 'victory':
          this.emitEvent('victory', { score: ev.score });
          break;
        case 'dryFire':
          audio?.play?.('dry');
          break;
        default:
          break;
      }
    }
  }

  _enemyDist(id) {
    const e = this.core.enemies.find((x) => x.id === id);
    return e ? e.flight.position.distanceTo(this.camera.position) : 2000;
  }

  _check(name) {
    if (this.checks.has(name)) return;
    this.checks.add(name);
    console.log(`pass ${name}`);
  }

  // ------------------------------------------------------------- autopilot
  _autopilot() {
    // Test-only pilot: hunts the current target with the same stick inputs a player has.
    const core = this.core;
    const pl = core.player;
    if (!pl.alive) return null;
    const t = pl.target;
    const fl = pl.flight;
    const dir = _v2;
    const agl = fl.position.y - groundAt(fl.position.x, fl.position.z);
    if (t && t.alive) dir.copy(t.flight.position).addScaledVector(t.flight.velocity, 0.6).sub(fl.position);
    else dir.set(-fl.position.x, 650 - fl.position.y, -fl.position.z);
    if (agl < 250) dir.normalize().add(_v.set(0, 2, 0));
    _q.copy(fl.quaternion).invert();
    const d = _v.copy(dir).normalize().applyQuaternion(_q);
    const rollErr = Math.atan2(d.x, d.y);
    const ahead = -d.z;
    const c = { pitch: 0, roll: 0, yaw: 0, boost: false, fire: false };
    if (ahead > 0.98) {
      c.pitch = clamp(d.y * 8, -1, 1);
      c.yaw = clamp(d.x * 8, -1, 1);
    } else {
      c.roll = clamp(rollErr * 2, -1, 1);
      c.pitch = clamp(Math.abs(rollErr) < 0.8 ? 1 : 0.3, -1, 1);
    }
    const dist = t && t.alive ? t.flight.position.distanceTo(fl.position) : Infinity;
    c.fire = ahead > 0.995 && dist < 1100;
    c.boost = dist > 1500;
    if (pl.locked && pl.missileTimer <= 0) this.input.pressQueue.push('missile');
    return c;
  }

  // ------------------------------------------------------------------ loop
  _loop(now) {
    if (this.disposed) return;
    this._idleRaf = requestAnimationFrame(this._loop);
    const rawDt = Math.min(0.1, (now - (this.lastTime || now)) / 1000);
    this.lastTime = now;
    const core = this.core;

    this.input.pollGamepad();
    const presses = this.input.takePresses();
    // mouse edges (RIGHT = missile, MIDDLE = next target) only count during active play
    const mouseEdges = this.controls.buttons.take();
    if (this.isActivePlay()) presses.push(...mouseEdges);
    for (const p of presses) {
      if (p === 'pause') {
        this.emitEvent('pauseRequested', { reason: 'key' });
      } else if (this.running && !this.paused) {
        if (p === 'missile') core.controls.missile = true;
        else if (p === 'camera') this.cameraMode = (this.cameraMode + 1) % 3;
        else if (p === 'target') { core.cycleTarget(); this.audio?.play?.('target'); }
      }
    }

    const active = this.running && !this.paused && core.status === 'playing';
    if (active) {
      const manual = {
        pitch: this.input.axis('pitch'),
        roll: this.input.axis('roll'),
        yaw: this.input.axis('yaw'),
        stick: this.input.hasStick(),
      };
      const stick = this.controls.update(rawDt, core.player.flight, manual);
      let ctl = {
        pitch: stick.pitch,
        roll: stick.roll,
        yaw: stick.yaw,
        boost: this.input.button('boost'),
        fire: this.input.button('fire') || this.controls.buttons.fire,
      };
      this._lastCtl = ctl;
      if (this.testMode) {
        if (!this.input.anyKeyHeld()) ctl = this._autopilot() || ctl;
        else { ctl.pitch *= 0.35; ctl.roll *= 0.35; } // Patch's held move keys: visible motion, no forced crash
      }
      core.setControls(ctl);
      this.accum += rawDt;
      let steps = 0;
      this._playerFiring = false;
      while (this.accum >= FIXED_DT && steps < 6) {
        core.update(FIXED_DT);
        this._handleEvents(core.drainEvents());
        this.accum -= FIXED_DT;
        steps++;
      }
      if (steps >= 6) this.accum = 0;
      this.audio?.setEngine?.(core.player.flight.speed / 330, core.player.flight.boosting, core.player.alive);
      this.audio?.setGun?.(this._playerFiring && core.player.alive);
      if (core.status !== 'playing') this.audio?.setGun?.(false);
    } else {
      this.audio?.setGun?.(false);
    }

    const visDt = this.paused ? 0 : rawDt;
    if (this.running) this._syncViews(visDt);
    this.fire.update(visDt);
    this.smoke.update(visDt);
    this.tracers.update(core.bullets);
    this.flash.intensity *= Math.exp(-visDt * 9);
    this.ocean.material.uniforms.uTime.value += visDt;
    this._updateCamera(rawDt, visDt);
    this.renderer.render(this.scene, this.camera);
    if (this.running) this.hud.draw(this.camera, core, this);
    else this.hud.ctx.clearRect(0, 0, this.hud.canvas.width, this.hud.canvas.height);
    if (this.testMode && this.running && !this.checks.has('scene-rendered') && this.playerTemplate) this._check('scene-rendered');

    if (this.running && now - this.lastTelemetry >= TELEMETRY_MS) {
      this.lastTelemetry = now;
      const t = core.getTelemetry();
      t.camera = ['chase', 'cockpit', 'far'][this.cameraMode];
      t.inputDevice = this.input.device;
      t.paused = this.paused;
      t.controlMode = this.controls.mode;
      t.controlLabel = MODE_LABELS[this.controls.mode];
      t.mouseCaptured = this.controls.captured;
      t.pointerLocked = this.controls.pointerLocked;
      t.cameraZoom = Math.round(this.controls.zoom * 100) / 100;
      this.onTelemetry(t);
    }
    // test mode: restart automatically after game over so checks can continue
    if (this.testMode && this.running && core.status === 'gameover' && !this._autoRestart) {
      this._autoRestart = setTimeout(() => { this._autoRestart = null; this.start(); }, 2500);
    }
  }

  _updateCamera(dt, visDt) {
    const cam = this.camera;
    const core = this.core;
    if (!this.running) {
      // title screen: slow orbit over the main island
      const t = performance.now() * 0.00004;
      cam.position.set(Math.sin(t) * 2400, 520, Math.cos(t) * 2400);
      cam.lookAt(0, 120, 0);
      cam.fov = 55;
      cam.updateProjectionMatrix();
      return;
    }
    const pl = core.player;
    const fl = pl.flight;
    const cs = this._cam || (this._cam = { desired: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), q: new THREE.Quaternion() });
    if (!pl.alive) {
      // orbit the wreck
      const t = performance.now() * 0.0003;
      const target = fl.position;
      cam.position.lerp(cs.desired.set(target.x + Math.sin(t) * 90, target.y + 40, target.z + Math.cos(t) * 90), damp(2, dt));
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      return;
    }
    if (this.cameraMode === 1) {
      fl.getForward(cs.fwd);
      fl.getUp(cs.up);
      cam.position.copy(fl.position).addScaledVector(cs.fwd, 2.5).addScaledVector(cs.up, 1.4);
      cam.quaternion.copy(fl.quaternion);
    } else {
      const far = this.cameraMode === 2;
      const base = { back: far ? 60 : 30, high: far ? 14 : 7.5, ahead: 60 };
      if (!cs.pose) cs.pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() };
      this.controls.cameraPose(fl, base, cs.pose);
      cs.desired.copy(cs.pose.pos);
      const back = base.back * this.controls.zoom;
      // snap if we are far away (start, restart, camera switch); otherwise smooth follow
      if (cam.position.distanceTo(fl.position) > back * 6) cam.position.copy(cs.desired);
      else cam.position.lerp(cs.desired, damp(far ? 5 : 8, dt));
      // keep a sane distance band so the camera never clips into the jet or drifts away
      const dist = cam.position.distanceTo(fl.position);
      if (dist < back * 0.7 || dist > back * 2.5) cam.position.sub(fl.position).setLength(Math.min(Math.max(dist, back * 0.7), back * 2.5)).add(fl.position);
      cs.look.copy(cs.pose.look);
      cam.up.lerp(cs.pose.up, damp(5, dt)).normalize();
      lookRotation(cam.position, cs.look, cam.up, cs.q);
      cam.quaternion.slerp(cs.q, damp(10, dt));
    }
    const ground = groundAt(cam.position.x, cam.position.z);
    if (cam.position.y < ground + 3) cam.position.y = ground + 3;
    // speed FOV + shake
    const speedK = clamp((fl.speed - 120) / 200, 0, 1);
    cam.fov += ((this.cameraMode === 1 ? 72 : 62) + speedK * 12 - cam.fov) * damp(3, dt);
    cam.updateProjectionMatrix();
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 2.5;
      cam.position.y += (Math.random() - 0.5) * this.shake * 2.5;
      this.shake *= Math.exp(-visDt * 5);
    }
  }

  _resize() {
    const el = this.canvas.parentElement || document.body;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    const maxDpr = this.quality === 'low' ? 0.75 : this.quality === 'medium' ? 1 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.hud?.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }
}

import { surfaceHeightAt, heightAt } from './engine/terrain.js';
function groundAt(x, z) {
  return surfaceHeightAt(x, z);
}
function heightCache(x, z) {
  return heightAt(x, z);
}
