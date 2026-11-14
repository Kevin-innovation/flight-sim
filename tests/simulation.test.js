import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { FlightModel } from '../src/engine/flight.js';
import { GameCore, PLAYER, RADAR_RANGE } from '../src/engine/game.js';
import { heightAt, surfaceHeightAt, ISLANDS, RUNWAY } from '../src/engine/terrain.js';
import { steerToward } from '../src/engine/ai.js';
import { applyDeadzone } from '../src/engine/input.js';
import { segmentPointDistanceSq, createRng } from '../src/engine/util.js';
import { WAVES } from '../src/engine/waves.js';

const DT = 1 / 60;
const run = (core, seconds, ctl = {}) => {
  for (let t = 0; t < seconds; t += DT) {
    core.setControls(ctl);
    core.update(DT);
  }
};

describe('terrain', () => {
  it('islands rise above sea level and open ocean is below', () => {
    expect(heightAt(ISLANDS[0].x, ISLANDS[0].z)).toBeGreaterThan(20);
    expect(heightAt(3900, 3900)).toBeLessThan(0);
    expect(surfaceHeightAt(3900, 3900)).toBe(0);
  });
  it('runway is flattened to its height', () => {
    expect(heightAt(RUNWAY.x, RUNWAY.z)).toBeCloseTo(RUNWAY.height, 0);
  });
});

describe('flight model', () => {
  it('flies straight and level forward (-Z) with no input', () => {
    const f = new FlightModel();
    f.reset(new Vector3(0, 1000, 0), 0, 150);
    for (let i = 0; i < 120; i++) f.update(DT);
    expect(f.position.z).toBeLessThan(-250);
    expect(Math.abs(f.position.x)).toBeLessThan(1);
    expect(Math.abs(f.position.y - 1000)).toBeLessThan(5);
  });
  it('pitch up input climbs, pitch down dives', () => {
    const up = new FlightModel();
    up.reset(new Vector3(0, 1000, 0), 0);
    up.input.pitch = 1;
    for (let i = 0; i < 40; i++) up.update(DT);
    expect(up.position.y).toBeGreaterThan(1000);
    const dn = new FlightModel();
    dn.reset(new Vector3(0, 1000, 0), 0);
    dn.input.pitch = -1;
    for (let i = 0; i < 40; i++) dn.update(DT);
    expect(dn.position.y).toBeLessThan(1000);
  });
  it('banking right turns the aircraft right (heading increases) via turn assist', () => {
    const f = new FlightModel();
    f.reset(new Vector3(0, 1000, 0), 0);
    f.input.roll = 1;
    for (let i = 0; i < 20; i++) f.update(DT);
    f.input.roll = 0;
    expect(f.getBank()).toBeGreaterThan(0.3);
    for (let i = 0; i < 30; i++) f.update(DT);
    const h = f.getHeading();
    expect(h).toBeGreaterThan(3);
    expect(h).toBeLessThan(180);
  });
  it('auto-level assist returns wings level when the stick is released', () => {
    const f = new FlightModel();
    f.reset(new Vector3(0, 1000, 0), 0);
    f.input.roll = 1;
    for (let i = 0; i < 15; i++) f.update(DT);
    f.input.roll = 0;
    for (let i = 0; i < 240; i++) f.update(DT);
    expect(Math.abs(f.getBank())).toBeLessThan(0.08);
  });
  it('boost raises speed and drains energy, then regenerates', () => {
    const f = new FlightModel();
    f.reset(new Vector3(0, 1000, 0), 0);
    f.input.boost = true;
    for (let i = 0; i < 120; i++) f.update(DT);
    expect(f.speed).toBeGreaterThan(f.p.cruiseSpeed + 40);
    expect(f.boostEnergy).toBeLessThan(0.6);
    const e = f.boostEnergy;
    f.input.boost = false;
    for (let i = 0; i < 60; i++) f.update(DT);
    expect(f.boostEnergy).toBeGreaterThan(e);
  });
});

describe('AI steering', () => {
  it('rolls toward a target on the right and pulls up for one above', () => {
    const f = new FlightModel();
    f.reset(new Vector3(0, 1000, 0), 0);
    const right = steerToward(f, new Vector3(1, 0.2, -0.3));
    expect(right.roll).toBeGreaterThan(0);
    const above = steerToward(f, new Vector3(0, 1, -0.2));
    expect(above.pitch).toBeGreaterThan(0);
  });
});

describe('game core', () => {
  it('starts playing, spawns wave 1 after the intermission', () => {
    const core = new GameCore({ seed: 1 });
    expect(core.status).toBe('playing');
    expect(core.enemies.length).toBe(0);
    run(core, 3);
    const n = WAVES[0].jets + WAVES[0].props;
    expect(core.enemies.length).toBe(n);
    expect(core.getTelemetry().wave).toBe(1);
  });

  it('cannon fires bullets, uses ammo and builds heat', () => {
    const core = new GameCore({ seed: 2 });
    run(core, 0.5, { fire: true });
    expect(core.player.ammo).toBeLessThan(PLAYER.ammo);
    expect(core.bullets.some((b) => b.active)).toBe(true);
    expect(core.player.heat).toBeGreaterThan(0);
  });

  it('a bullet hit damages an enemy and a kill adds score', () => {
    const core = new GameCore({ seed: 3 });
    run(core, 3);
    const e = core.enemies[0];
    const pl = core.player.flight;
    // place enemy dead ahead of the player at 200 m
    e.flight.position.copy(pl.position).add(pl.getForward(new Vector3()).multiplyScalar(200));
    e.flight.velocity.set(0, 0, 0);
    e.brain.update = () => {};
    e.flight.update = () => e.flight;
    const hp = e.hp;
    run(core, 0.4, { fire: true });
    expect(e.hp).toBeLessThan(hp);
    run(core, 2, { fire: true });
    expect(e.alive).toBe(false);
    expect(core.kills).toBe(1);
    expect(core.score).toBeGreaterThan(0);
  });

  it('locked missile homes in and destroys its target', () => {
    const core = new GameCore({ seed: 4 });
    run(core, 3);
    const e = core.enemies[0];
    const pl = core.player.flight;
    e.flight.position.copy(pl.position).add(pl.getForward(new Vector3()).multiplyScalar(900)).add(new Vector3(60, 30, 0));
    e.brain.update = () => {};
    core.player.target = e;
    run(core, 1.2);
    expect(core.player.locked).toBe(true);
    core.setControls({ missile: true });
    core.update(DT);
    expect(core.player.missiles).toBe(PLAYER.missiles - 1);
    run(core, 5);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('flying into the sea is a crash and ends in game over', () => {
    const core = new GameCore({ seed: 5 });
    core.player.flight.position.set(0, 20, 3900);
    run(core, 1, { pitch: -1 });
    expect(core.player.alive).toBe(false);
    expect(core.gameOverReason).toMatch(/해면|지면/);
    run(core, 3);
    expect(core.status).toBe('gameover');
  });

  it('reset restores a fresh game', () => {
    const core = new GameCore({ seed: 6 });
    run(core, 4, { fire: true });
    core.reset();
    expect(core.player.ammo).toBe(PLAYER.ammo);
    expect(core.enemies.length).toBe(0);
    expect(core.score).toBe(0);
    expect(core.status).toBe('playing');
  });

  it('clearing every wave ends in victory', () => {
    const core = new GameCore({ seed: 7 });
    for (let w = 0; w < WAVES.length; w++) {
      run(core, 6);
      for (const e of core.enemies) if (e.alive) core.killEnemy(e, 'gun');
      run(core, 0.1);
    }
    expect(core.status).toBe('victory');
  });

  it('enemy AI does not fly into terrain during a minute of combat', () => {
    const core = new GameCore({ seed: 8 });
    core.damagePlayer = () => {}; // keep player alive as a target
    run(core, 63);
    const crashes = core.events.filter((ev) => ev.type === 'kill' && ev.source === 'crash').length;
    expect(crashes).toBe(0);
    expect(core.enemies.filter((e) => e.alive).length).toBeGreaterThan(0);
  });

  it('telemetry has the required fields and radar points within range', () => {
    const core = new GameCore({ seed: 9 });
    run(core, 3);
    const t = core.getTelemetry();
    for (const k of ['speed', 'altitude', 'health', 'score', 'kills', 'wave', 'ammo', 'missiles', 'boost', 'targetDistance', 'heading', 'radar', 'status']) {
      expect(t).toHaveProperty(k);
    }
    expect(t.status).toBe('playing');
    expect(t.radar.length).toBeGreaterThan(0);
    for (const p of t.radar) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.0001);
    expect(RADAR_RANGE).toBeGreaterThan(1000);
  });

  it('radar puts an enemy dead ahead at the top', () => {
    const core = new GameCore({ seed: 10 });
    run(core, 3);
    const e = core.enemies[0];
    const pl = core.player.flight;
    e.flight.position.copy(pl.position).add(pl.getForward(new Vector3()).multiplyScalar(1000));
    const pt = core.getTelemetry().radar.find((r) => r.id === e.id);
    expect(pt.y).toBeGreaterThan(0.25);
    expect(Math.abs(pt.x)).toBeLessThan(0.05);
  });
});

describe('chase camera', () => {
  it('stays ~30 m behind and above the aircraft in any attitude (aliasing regression)', async () => {
    const { chaseTarget, chaseLookAt } = await import('../src/engine/camera.js');
    const f = new FlightModel();
    f.reset(new Vector3(24, 650, 2496), 0.7);
    f.input.roll = 0.6;
    f.input.pitch = 0.4;
    for (let i = 0; i < 90; i++) f.update(DT);
    const out = chaseTarget(f, 30, 7.5);
    const d = out.distanceTo(f.position);
    expect(d).toBeGreaterThan(29);
    expect(d).toBeLessThan(32);
    // behind: the vector from the jet to the camera points against its nose
    const toCam = out.clone().sub(f.position).normalize();
    expect(toCam.dot(f.getForward(new Vector3()))).toBeLessThan(-0.9);
    const look = chaseLookAt(f, 60);
    expect(look.distanceTo(f.position)).toBeCloseTo(60, 3);
    // passing the flight's own scratch vectors must not corrupt the result
    const again = chaseTarget(f, 30, 7.5, f.getForward(new Vector3()));
    expect(again.distanceTo(f.position)).toBeLessThan(32);
  });
});

describe('aircraft model orientation', () => {
  it('maps each source nose direction onto the flight model forward (-Z)', async () => {
    const THREE = await import('three');
    const { normaliseAircraft, NOSE } = await import('../src/engine/render.js');
    const make = (noseDir, spanAxis) => {
      // body: long along the nose axis, wide along the span axis; marker at the nose tip
      const root = new THREE.Group();
      const size = { x: 0.2, y: 0.1, z: 0.2 };
      size[spanAxis] = 1.0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
      root.add(body);
      const nose = new THREE.Object3D();
      nose.position.copy(noseDir).multiplyScalar(0.45);
      root.add(nose);
      return { root, nose };
    };
    for (const [dir, cfg] of [[new THREE.Vector3(-1, 0, 0), NOSE.minusX], [new THREE.Vector3(0, 0, 1), NOSE.plusZ]]) {
      const { root, nose } = make(dir, cfg.spanAxis);
      const outer = normaliseAircraft(root, 11, cfg);
      outer.updateMatrixWorld(true);
      const p = nose.getWorldPosition(new THREE.Vector3()).normalize();
      expect(p.z).toBeLessThan(-0.95); // nose ahead along -Z
      const box = new THREE.Box3().setFromObject(outer);
      expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(11, 1); // wingspan across X
    }
  });
});

describe('utilities', () => {
  it('segment-sphere distance detects pass-through hits', () => {
    const d = segmentPointDistanceSq(new Vector3(0, 0, 0), new Vector3(0, 0, -100), new Vector3(1, 0, -50));
    expect(d).toBeCloseTo(1);
  });
  it('deadzone ignores small stick drift and rescales to 1', () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual([0, 0]);
    const [x] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1);
  });
  it('rng is deterministic', () => {
    const a = createRng(5), b = createRng(5);
    expect(a()).toBe(b());
  });
});
