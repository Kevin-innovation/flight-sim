// Headless combat simulation: player, enemies, weapons, waves, scoring.
// No rendering or DOM here so it can be unit tested in Node.
import { Vector3 } from 'three';
import { FlightModel } from './flight.js';
import { EnemyBrain } from './ai.js';
import { WAVES, ENEMY_TYPES, waveEnemyList } from './waves.js';
import { surfaceHeightAt, heightAt, SEA_LEVEL, ARENA_RADIUS, ARENA_WARN_RADIUS } from './terrain.js';
import { clamp, createRng, segmentPointDistanceSq } from './util.js';

export const PLAYER = {
  maxHp: 100,
  radius: 8,
  ammo: 900,
  missiles: 8,
  fireInterval: 1 / 14,
  bulletSpeed: 1050,
  bulletLife: 1.35,
  bulletDamage: 7,
  heatPerShot: 0.045,
  coolRate: 0.38,
  lockRange: 2300,
  lockCone: Math.cos((22 * Math.PI) / 180),
  lockTime: 0.85,
  missileCooldown: 0.9,
};

export const MISSILE = {
  player: { maxSpeed: 580, accel: 260, turnRate: 2.5, life: 7, damage: 120, fuse: 22, seekerCone: Math.cos((75 * Math.PI) / 180) },
  enemy: { maxSpeed: 480, accel: 200, turnRate: 1.75, life: 6.5, damage: 34, fuse: 16, seekerCone: Math.cos((60 * Math.PI) / 180) },
};

export const RADAR_RANGE = 3200;
const MAX_BULLETS = 600;
const MAX_MISSILES = 40;
const INTERMISSION = 4.5;

const _v = new Vector3();
const _v2 = new Vector3();
const _f = new Vector3();

function makeBullet() {
  return { active: false, pos: new Vector3(), prev: new Vector3(), vel: new Vector3(), life: 0, team: 'player', damage: 0 };
}
function makeMissile() {
  return { active: false, id: 0, pos: new Vector3(), vel: new Vector3(), speed: 0, target: null, life: 0, team: 'player', cfg: MISSILE.player, tracking: true };
}

export class GameCore {
  constructor({ seed = 1337 } = {}) {
    this.seed = seed;
    this.bullets = Array.from({ length: MAX_BULLETS }, makeBullet);
    this.missiles = Array.from({ length: MAX_MISSILES }, makeMissile);
    this.events = [];
    this.controls = { pitch: 0, roll: 0, yaw: 0, boost: false, fire: false, missile: false };
    this.reset();
  }

  reset() {
    this.rng = createRng(this.seed);
    this.time = 0;
    this.status = 'playing';
    this.score = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.waveIndex = -1;
    this.waveState = 'intermission';
    this.waveTimer = 2.5;
    this.warning = null;
    this.message = '작전 개시 — 적 편대 접근 중';
    this.messageTimer = 3;
    this.nextId = 1;
    this.endTimer = 0;
    this.gameOverReason = null;
    for (const b of this.bullets) b.active = false;
    for (const m of this.missiles) m.active = false;
    this.enemies = [];
    this.events.length = 0;

    const flight = new FlightModel();
    flight.reset(new Vector3(0, 650, 2900), 0, 170);
    this.player = {
      id: 0,
      team: 'player',
      flight,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      alive: true,
      radius: PLAYER.radius,
      ammo: PLAYER.ammo,
      missiles: PLAYER.missiles,
      heat: 0,
      overheated: false,
      fireTimer: 0,
      gunSide: 1,
      missileTimer: 0,
      target: null,
      lockProgress: 0,
      locked: false,
      damageFlash: 0,
    };
    this.controls.fire = this.controls.missile = false;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  setControls(c) {
    Object.assign(this.controls, c);
  }

  // ------------------------------------------------------------------ waves
  spawnWave(index) {
    this.waveIndex = index;
    const def = WAVES[index];
    const kinds = waveEnemyList(index);
    const p = this.player.flight.position;
    const pf = this.player.flight.getForward(_f);
    // spawn ahead of the player, spread in a loose formation
    const baseYaw = Math.atan2(-pf.x, -pf.z);
    kinds.forEach((kind, i) => {
      const t = ENEMY_TYPES[kind];
      const flight = new FlightModel({ cruiseSpeed: t.cruise, boostSpeed: t.boost, pitchRate: t.pitchRate, rollRate: t.rollRate });
      const ang = baseYaw + (i - (kinds.length - 1) / 2) * 0.32 + (this.rng() - 0.5) * 0.2;
      const dist = 2600 + this.rng() * 700;
      const pos = new Vector3(p.x - Math.sin(ang) * dist, 0, p.z - Math.cos(ang) * dist);
      // keep inside arena
      const r = Math.hypot(pos.x, pos.z);
      if (r > ARENA_WARN_RADIUS - 300) pos.multiplyScalar((ARENA_WARN_RADIUS - 300) / r);
      pos.y = Math.max(surfaceHeightAt(pos.x, pos.z) + 350, 550 + this.rng() * 600);
      // face the player
      const yaw = Math.atan2(-(p.x - pos.x), -(p.z - pos.z));
      flight.reset(pos, yaw, t.cruise);
      const hp = Math.round(t.hp * (1 + index * 0.12));
      this.enemies.push({
        id: this.nextId++,
        team: 'enemy',
        kind,
        model: t.model,
        callsign: `${t.callsign}-${i + 1}`,
        flight,
        brain: new EnemyBrain(this.rng, def.skill + (this.rng() - 0.5) * 0.1),
        hp,
        maxHp: hp,
        alive: true,
        radius: t.radius,
        canMissile: def.missiles && kind === 'jet',
        fireTimer: 0,
        gunSide: 1,
        scoreValue: t.score,
        hitFlash: 0,
      });
    });
    this.waveState = 'combat';
    this.message = `WAVE ${index + 1} — ${def.name}`;
    this.messageTimer = 3;
    this.emit('waveStart', { wave: index + 1, name: def.name, count: kinds.length });
  }

  aliveEnemies() {
    return this.enemies.filter((e) => e.alive);
  }

  // -------------------------------------------------------------- targeting
  /** Score how "in front" an enemy is (lower is better). */
  targetCost(e) {
    const pl = this.player.flight;
    _v.copy(e.flight.position).sub(pl.position);
    const d = _v.length();
    const cos = pl.getForward(_f).dot(_v.normalize());
    return d * (2.2 - cos);
  }

  autoTarget() {
    const pl = this.player;
    if (pl.target && pl.target.alive) return;
    let best = null, bestCost = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const c = this.targetCost(e);
      if (c < bestCost) { bestCost = c; best = e; }
    }
    if (best !== pl.target) {
      pl.target = best;
      pl.lockProgress = 0;
      pl.locked = false;
    }
  }

  cycleTarget() {
    const alive = this.aliveEnemies().sort((a, b) => this.targetCost(a) - this.targetCost(b));
    if (!alive.length) return null;
    const idx = alive.indexOf(this.player.target);
    this.player.target = alive[(idx + 1) % alive.length];
    this.player.lockProgress = 0;
    this.player.locked = false;
    this.emit('targetChanged', { id: this.player.target.id });
    return this.player.target;
  }

  updateLock(dt) {
    const pl = this.player;
    const t = pl.target;
    if (!t || !t.alive) { pl.lockProgress = 0; pl.locked = false; return; }
    _v.copy(t.flight.position).sub(pl.flight.position);
    const d = _v.length();
    const cos = pl.flight.getForward(_f).dot(_v.normalize());
    const inCone = d < PLAYER.lockRange && cos > PLAYER.lockCone;
    const wasLocked = pl.locked;
    if (inCone) pl.lockProgress = Math.min(1, pl.lockProgress + dt / PLAYER.lockTime);
    else pl.lockProgress = Math.max(0, pl.lockProgress - dt * 1.5);
    pl.locked = pl.lockProgress >= 1;
    if (pl.locked && !wasLocked) this.emit('lock', { id: t.id });
  }

  // ---------------------------------------------------------------- weapons
  fireBullet(shooter, speed, life, damage, spread) {
    const b = this.bullets.find((x) => !x.active);
    if (!b) return null;
    const fl = shooter.flight;
    const fwd = fl.getForward(_f);
    const right = fl.getRight(_v2);
    shooter.gunSide = -shooter.gunSide;
    b.active = true;
    b.team = shooter.team;
    b.life = life;
    b.damage = damage;
    b.pos.copy(fl.position).addScaledVector(fwd, 9).addScaledVector(right, shooter.gunSide * 2.2);
    b.prev.copy(b.pos);
    b.vel.copy(fwd);
    if (spread > 0) {
      b.vel.x += (this.rng() - 0.5) * spread;
      b.vel.y += (this.rng() - 0.5) * spread;
      b.vel.z += (this.rng() - 0.5) * spread;
      b.vel.normalize();
    }
    b.vel.multiplyScalar(speed).add(fl.velocity);
    return b;
  }

  launchMissile(shooter, target) {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return null;
    const fl = shooter.flight;
    const fwd = fl.getForward(_f);
    m.active = true;
    m.id = this.nextId++;
    m.team = shooter.team;
    m.cfg = shooter.team === 'player' ? MISSILE.player : MISSILE.enemy;
    m.target = target;
    m.tracking = !!target;
    m.life = m.cfg.life;
    m.speed = fl.speed + 20;
    shooter.gunSide = -shooter.gunSide;
    m.pos.copy(fl.position).addScaledVector(fl.getUp(_v2), -1.8).addScaledVector(fl.getRight(_v2), shooter.gunSide * 3);
    m.vel.copy(fwd).multiplyScalar(m.speed);
    this.emit('missileLaunch', { team: m.team, id: m.id, targetId: target ? target.id : null });
    return m;
  }

  updatePlayerWeapons(dt) {
    const pl = this.player;
    const c = this.controls;
    pl.fireTimer -= dt;
    pl.missileTimer -= dt;
    pl.heat = Math.max(0, pl.heat - PLAYER.coolRate * dt);
    if (pl.overheated && pl.heat < 0.35) pl.overheated = false;
    if (c.fire && !pl.overheated && pl.ammo > 0) {
      while (pl.fireTimer <= 0 && pl.ammo > 0) {
        pl.fireTimer += PLAYER.fireInterval;
        this.fireBullet(pl, PLAYER.bulletSpeed, PLAYER.bulletLife, PLAYER.bulletDamage, 0.006);
        pl.ammo--;
        this.shots++;
        pl.heat += PLAYER.heatPerShot;
        if (pl.heat >= 1) { pl.overheated = true; this.emit('overheat'); break; }
      }
      this.emit('gunFiring', { team: 'player' });
    } else if (pl.fireTimer < 0) pl.fireTimer = 0;

    if (c.missile) {
      c.missile = false; // edge triggered
      if (pl.missiles > 0 && pl.missileTimer <= 0) {
        this.launchMissile(pl, pl.locked ? pl.target : null);
        pl.missiles--;
        pl.missileTimer = PLAYER.missileCooldown;
      } else {
        this.emit('dryFire');
      }
    }
  }

  updateBullets(dt) {
    const pl = this.player;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0) { b.active = false; continue; }
      // hit test
      if (b.team === 'player') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const r = e.radius + 2;
          if (segmentPointDistanceSq(b.prev, b.pos, e.flight.position) < r * r) {
            b.active = false;
            this.hits++;
            this.damageEnemy(e, b.damage, b.pos, 'gun');
            break;
          }
        }
      } else if (pl.alive) {
        const r = pl.radius + 1.5;
        if (segmentPointDistanceSq(b.prev, b.pos, pl.flight.position) < r * r) {
          b.active = false;
          this.damagePlayer(b.damage, b.pos, 'gun');
        }
      }
      if (b.active && b.pos.y < 340) {
        const h = surfaceHeightAt(b.pos.x, b.pos.z);
        if (b.pos.y < h) {
          b.active = false;
          this.emit('impact', { pos: b.pos.clone(), water: h <= SEA_LEVEL + 0.01 });
        }
      }
    }
  }

  updateMissiles(dt) {
    for (const m of this.missiles) {
      if (!m.active) continue;
      const cfg = m.cfg;
      m.life -= dt;
      m.speed = Math.min(cfg.maxSpeed, m.speed + cfg.accel * dt);
      const dir = _f.copy(m.vel).normalize();
      const t = m.target;
      if (m.tracking && t && t.alive) {
        // lead the target
        _v.copy(t.flight.position).sub(m.pos);
        const dist = _v.length();
        _v.divideScalar(Math.max(dist, 1e-3));
        // time to intercept uses the closing speed, so head-on shots don't over-lead
        const closing = m.speed - _v2.copy(t.flight.velocity).dot(_v);
        const tof = Math.min(4, dist / Math.max(closing, 60));
        _v.copy(t.flight.position).addScaledVector(t.flight.velocity, tof * 0.9).sub(m.pos).normalize();
        const cos = clamp(dir.dot(_v), -1, 1);
        const age = cfg.life - m.life;
        if (cos < cfg.seekerCone && age > 0.35) {
          m.tracking = false; // target out-manoeuvred the seeker
          if (t.team === 'player') this.emit('missileEvaded', { id: m.id });
        } else {
          const angle = Math.acos(cos);
          const maxTurn = cfg.turnRate * dt;
          const k = angle > 1e-5 ? Math.min(1, maxTurn / angle) : 1;
          dir.lerp(_v, k).normalize();
        }
        // proximity fuse
        if (dist < cfg.fuse) {
          this.detonateMissile(m, t);
          continue;
        }
      }
      m.vel.copy(dir).multiplyScalar(m.speed);
      m.pos.addScaledVector(m.vel, dt);

      // dumb-fired / lost missiles can still hit anything close
      if (!m.tracking) {
        const victims = m.team === 'player' ? this.enemies : [this.player];
        for (const v of victims) {
          if (v.alive && v.flight.position.distanceToSquared(m.pos) < cfg.fuse * cfg.fuse * 0.6) {
            this.detonateMissile(m, v);
            break;
          }
        }
        if (!m.active) continue;
      }
      if (m.pos.y < 340 && m.pos.y < surfaceHeightAt(m.pos.x, m.pos.z)) {
        m.active = false;
        this.emit('explosion', { pos: m.pos.clone(), size: 0.8, water: heightAt(m.pos.x, m.pos.z) < SEA_LEVEL });
        continue;
      }
      if (m.life <= 0) {
        m.active = false;
        this.emit('explosion', { pos: m.pos.clone(), size: 0.5, air: true });
      }
    }
  }

  detonateMissile(m, victim) {
    m.active = false;
    this.emit('explosion', { pos: m.pos.clone(), size: 1, air: true });
    if (victim.team === 'enemy') this.damageEnemy(victim, m.cfg.damage, m.pos, 'missile');
    else this.damagePlayer(m.cfg.damage, m.pos, 'missile');
  }

  // ----------------------------------------------------------------- damage
  damageEnemy(e, amount, pos, source) {
    if (!e.alive) return;
    e.hp -= amount;
    e.hitFlash = 0.15;
    this.emit('hit', { team: 'enemy', id: e.id, pos: pos.clone(), source });
    if (e.hp <= 0) this.killEnemy(e, source);
  }

  killEnemy(e, source) {
    e.alive = false;
    e.hp = 0;
    this.kills++;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 7;
    const mult = 1 + this.waveIndex * 0.25;
    const comboBonus = (this.combo - 1) * 50;
    const pts = Math.round(e.scoreValue * mult) + comboBonus + (source === 'missile' ? 0 : 25);
    this.score += pts;
    this.emit('kill', { id: e.id, callsign: e.callsign, pos: e.flight.position.clone(), vel: e.flight.velocity.clone(), points: pts, combo: this.combo, source });
    this.emit('explosion', { pos: e.flight.position.clone(), size: 2.2, air: true, debris: true });
    if (this.player.target === e) {
      this.player.target = null;
      this.player.locked = false;
      this.player.lockProgress = 0;
    }
  }

  damagePlayer(amount, pos, source) {
    const pl = this.player;
    if (!pl.alive || this.status !== 'playing') return;
    pl.hp = Math.max(0, pl.hp - amount);
    pl.damageFlash = 0.35;
    this.emit('playerHit', { amount, pos: pos ? pos.clone() : pl.flight.position.clone(), source });
    if (pl.hp <= 0) this.killPlayer(source === 'missile' ? '미사일 피격' : source === 'boundary' ? '작전 구역 이탈' : '격추됨');
  }

  killPlayer(reason, water = false) {
    const pl = this.player;
    if (!pl.alive) return;
    pl.alive = false;
    pl.hp = 0;
    this.gameOverReason = reason;
    this.emit('explosion', { pos: pl.flight.position.clone(), size: 2.6, air: !water, water, debris: true, player: true });
    this.emit('playerDown', { reason });
    this.endTimer = 2.2; // let the explosion play before reporting game over
  }

  // ------------------------------------------------------------- collisions
  checkCollisions() {
    const pl = this.player;
    const fl = pl.flight;
    if (pl.alive) {
      const ground = surfaceHeightAt(fl.position.x, fl.position.z);
      if (fl.position.y - ground < 2.5) {
        const water = ground <= SEA_LEVEL + 0.01;
        this.killPlayer(water ? '해면 충돌' : '지면 충돌', water);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const p = e.flight.position;
      const g = surfaceHeightAt(p.x, p.z);
      if (p.y - g < 2.5) {
        this.killEnemy(e, 'crash');
        continue;
      }
      if (pl.alive) {
        const r = (e.radius + pl.radius) * 0.8;
        if (p.distanceToSquared(fl.position) < r * r) {
          this.killEnemy(e, 'ram');
          this.damagePlayer(70, p, 'ram');
        }
      }
    }
  }

  updateWarnings(dt) {
    const pl = this.player;
    const fl = pl.flight;
    this.warning = null;
    if (!pl.alive) return;
    const r = Math.hypot(fl.position.x, fl.position.z);
    if (r > ARENA_RADIUS) {
      this.warning = 'boundary';
      this.damagePlayer(9 * dt, null, 'boundary');
    } else if (r > ARENA_WARN_RADIUS) this.warning = 'boundary';
    const agl = fl.position.y - surfaceHeightAt(fl.position.x, fl.position.z);
    if (agl < 140 && fl.velocity.y < -8) this.warning = 'pullup';
    else if (fl.position.y > 3200) this.warning = 'ceiling';
    if (this.incomingMissile()) this.warning = this.warning === 'pullup' ? 'pullup' : 'missile';
  }

  incomingMissile() {
    for (const m of this.missiles) if (m.active && m.team === 'enemy' && m.tracking && m.target === this.player) return m;
    return null;
  }

  // ------------------------------------------------------------------- tick
  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    const pl = this.player;

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message = null;
    }
    if (this.comboTimer > 0) this.comboTimer -= dt;
    pl.damageFlash = Math.max(0, pl.damageFlash - dt);

    // Player flight
    if (pl.alive) {
      const c = this.controls;
      pl.flight.input.pitch = c.pitch;
      pl.flight.input.roll = c.roll;
      pl.flight.input.yaw = c.yaw;
      pl.flight.input.boost = c.boost;
      pl.flight.update(dt);
      // hard ceiling: nose gently pushed down by thin air
      if (pl.flight.position.y > 3600) pl.flight.position.y = 3600;
      this.autoTarget();
      this.updateLock(dt);
      this.updatePlayerWeapons(dt);
    }

    // Enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.brain.update(dt, e, pl);
      e.flight.update(dt);
      e.fireTimer -= dt;
      if (e.brain.wantFire && pl.alive && e.fireTimer <= 0) {
        e.fireTimer = 0.11;
        this.fireBullet(e, 900, 1.2, 3 + e.brain.skill * 2.5, 0.03 - e.brain.skill * 0.015);
        this.emit('gunFiring', { team: 'enemy', id: e.id });
      }
      if (e.brain.wantMissile && pl.alive) {
        this.launchMissile(e, pl);
        this.emit('missileWarning', { from: e.id });
      }
    }

    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.checkCollisions();
    this.updateWarnings(dt);

    // Remove long-dead enemies (renderer has had time to show the wreck)
    if (this.enemies.length > 24) this.enemies = this.enemies.filter((e) => e.alive);

    // Waves
    if (this.waveState === 'combat' && this.aliveEnemies().length === 0 && pl.alive) {
      const bonus = 300 * (this.waveIndex + 1) + Math.round(pl.hp * 2);
      this.score += bonus;
      this.emit('waveClear', { wave: this.waveIndex + 1, bonus });
      if (this.waveIndex >= WAVES.length - 1) {
        this.score += Math.round(pl.hp * 10);
        this.status = 'victory';
        this.emit('victory', { score: this.score });
        return;
      }
      this.waveState = 'intermission';
      this.waveTimer = INTERMISSION;
      pl.hp = Math.min(pl.maxHp, pl.hp + 30);
      pl.ammo = PLAYER.ammo;
      pl.missiles = Math.min(PLAYER.missiles, pl.missiles + 4);
      this.message = `WAVE ${this.waveIndex + 1} 클리어 +${bonus} — 정비·재무장`;
      this.messageTimer = INTERMISSION - 0.5;
    } else if (this.waveState === 'intermission') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0 && pl.alive) this.spawnWave(this.waveIndex + 1);
    }

    if (!pl.alive) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.status = 'gameover';
        this.emit('gameover', { score: this.score, reason: this.gameOverReason });
      }
    }
  }

  // -------------------------------------------------------------- telemetry
  getTelemetry() {
    const pl = this.player;
    const fl = pl.flight;
    const headingDeg = fl.getHeading();
    const h = (headingDeg * Math.PI) / 180;
    const ch = Math.cos(h), sh = Math.sin(h);
    const radar = [];
    const toRadar = (pos, type, extra) => {
      const dx = pos.x - fl.position.x, dz = pos.z - fl.position.z;
      let x = (dx * ch + dz * sh) / RADAR_RANGE;
      let y = (dx * sh - dz * ch) / RADAR_RANGE;
      const len = Math.hypot(x, y);
      const edge = len > 1;
      if (edge) { x /= len; y /= len; }
      radar.push({ x, y, type, edge, alt: Math.round(pos.y - fl.position.y), ...extra });
    };
    for (const e of this.enemies) if (e.alive) toRadar(e.flight.position, e === pl.target ? 'target' : 'enemy', { id: e.id, kind: e.kind });
    for (const m of this.missiles) if (m.active && m.team === 'enemy') toRadar(m.pos, 'missile', { id: m.id });

    const t = pl.target && pl.target.alive ? pl.target : null;
    const targetDistance = t ? Math.round(t.flight.position.distanceTo(fl.position)) : null;
    const alt = fl.position.y;
    const agl = alt - surfaceHeightAt(fl.position.x, fl.position.z);
    return {
      status: this.status,
      speed: Math.round(fl.speed * 3.6), // km/h
      altitude: Math.round(alt),
      agl: Math.round(agl),
      health: Math.round(pl.hp),
      maxHealth: pl.maxHp,
      score: this.score,
      kills: this.kills,
      wave: Math.max(1, this.waveIndex + 1),
      waves: WAVES.length,
      enemiesLeft: this.aliveEnemies().length,
      ammo: pl.ammo,
      missiles: pl.missiles,
      boost: Math.round(fl.boostEnergy * 100) / 100,
      boosting: fl.boosting,
      heat: Math.round(pl.heat * 100) / 100,
      overheated: pl.overheated,
      targetDistance,
      targetName: t ? t.callsign : null,
      targetHealth: t ? t.hp / t.maxHp : null,
      lock: Math.round(pl.lockProgress * 100) / 100,
      locked: pl.locked,
      heading: Math.round(headingDeg),
      pitch: Math.round((Math.asin(clamp(fl.getForward(_f).y, -1, 1)) * 180) / Math.PI),
      bank: Math.round((fl.getBank() * 180) / Math.PI),
      gForce: Math.round(fl.gForce * 10) / 10,
      radar,
      warning: this.warning,
      missileIncoming: !!this.incomingMissile(),
      message: this.message,
      combo: this.comboTimer > 0 ? this.combo : 0,
      accuracy: this.shots ? Math.round((this.hits / this.shots) * 100) : 0,
      alive: pl.alive,
      gameOverReason: this.gameOverReason,
      time: Math.round(this.time),
    };
  }
}
