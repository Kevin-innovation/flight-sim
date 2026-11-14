// Dogfighting AI: pursue with lead, break/evade when threatened, extend after
// overshoots, always avoid terrain. Produces stick inputs for a FlightModel.
import { Vector3, Quaternion } from 'three';
import { clamp } from './util.js';
import { surfaceHeightAt } from './terrain.js';

const _inv = new Quaternion();
const _d = new Vector3();
const _to = new Vector3();
const _f = new Vector3();
const _pf = new Vector3();
const _probe = new Vector3();

/**
 * Turn a desired world direction into stick inputs (bank-and-pull).
 * Exported for tests.
 */
export function steerToward(flight, dirWorld, aggression = 1, out = { pitch: 0, roll: 0, yaw: 0 }) {
  _inv.copy(flight.quaternion).invert();
  const d = _d.copy(dirWorld).normalize().applyQuaternion(_inv); // local frame
  const ahead = -d.z; // 1 = dead ahead
  if (ahead > 0.985) {
    // fine tracking
    out.pitch = clamp(d.y * 6, -1, 1);
    out.yaw = clamp(d.x * 6, -1, 1);
    out.roll = clamp(-flight.getBank() * 1.2, -1, 1);
  } else {
    const rollErr = Math.atan2(d.x, d.y); // angle of target around nose from "up"
    out.roll = clamp(rollErr * 2.2, -1, 1) * aggression;
    const aligned = Math.abs(rollErr) < 0.9 ? 1 : 0.35;
    out.pitch = clamp((d.y > 0 ? 0.6 + d.y : d.y * 0.6) * aligned * aggression + (ahead < 0 ? 0.4 : 0), -0.6, 1);
    out.yaw = clamp(d.x * 1.5, -1, 1);
  }
  return out;
}

export class EnemyBrain {
  constructor(rng, skill = 0.5) {
    this.rng = rng;
    this.skill = skill; // 0..1
    this.state = 'pursue';
    this.stateTime = 0;
    this.jink = new Vector3();
    this.fireCooldown = 1 + rng() * 2;
    this.missileCooldown = 8 + rng() * 6;
    this.wantFire = false;
    this.wantMissile = false;
  }

  /**
   * @param self   enemy entity {flight}
   * @param target player entity {flight, alive}
   */
  update(dt, self, target) {
    const fl = self.flight;
    const pos = fl.position;
    const fwd = fl.getForward(_f);
    this.stateTime += dt;
    this.wantFire = false;
    this.wantMissile = false;
    this.fireCooldown -= dt;
    this.missileCooldown -= dt;

    let desired = _probe;
    let aggression = 0.75 + this.skill * 0.35;
    let boost = false;

    const tAlive = target && target.alive;
    let dist = Infinity;
    if (tAlive) {
      _to.copy(target.flight.position).sub(pos);
      dist = _to.length();
    }

    // State transitions
    if (tAlive) {
      const pf = target.flight.getForward(_pf);
      // Is the player behind us and pointing at us?
      const toMe = _d.copy(pos).sub(target.flight.position).normalize();
      const threatened = dist < 900 && pf.dot(toMe) > 0.94 && fwd.dot(toMe) > 0.2;
      if (this.state === 'pursue' && threatened && this.rng() < dt * (0.6 + this.skill)) {
        this.state = 'evade';
        this.stateTime = 0;
        this.jink.set(this.rng() - 0.5, 0.3 + this.rng() * 0.5, this.rng() - 0.5).normalize();
      } else if (this.state === 'pursue' && dist < 140) {
        this.state = 'extend';
        this.stateTime = 0;
      } else if (this.state === 'evade' && this.stateTime > 2.2 + this.rng() * 1.5) {
        this.state = 'pursue';
        this.stateTime = 0;
      } else if (this.state === 'extend' && this.stateTime > 2.5) {
        this.state = 'pursue';
        this.stateTime = 0;
      }
    } else {
      this.state = 'patrol';
    }

    if (this.state === 'pursue' && tAlive) {
      // lead pursuit
      const tof = clamp(dist / 900, 0, 1.6) * (0.4 + this.skill * 0.6);
      desired.copy(target.flight.position).addScaledVector(target.flight.velocity, tof).sub(pos);
      boost = dist > 1400;
    } else if (this.state === 'evade') {
      if (this.stateTime % 1.2 < dt) {
        this.jink.set(this.rng() - 0.5, (this.rng() - 0.3) * 0.8, this.rng() - 0.5).normalize();
      }
      desired.copy(this.jink).multiplyScalar(2).add(fwd);
      aggression = 1.1;
      boost = true;
    } else if (this.state === 'extend') {
      desired.copy(fwd).multiplyScalar(3).add(_d.set(0, 0.25, 0));
      boost = true;
    } else {
      // patrol: gentle circle around the main island at altitude
      desired.set(-pos.z, 0, pos.x).normalize().multiplyScalar(2).add(_d.set(-pos.x, 0, -pos.z).normalize());
      desired.y = (650 - pos.y) / 400;
      aggression = 0.5;
    }

    // Terrain avoidance: probe ahead along velocity.
    const look = clamp(fl.speed * 2.6, 200, 700);
    const ahead = _d.copy(pos).addScaledVector(fwd, look);
    const groundAhead = Math.max(surfaceHeightAt(ahead.x, ahead.z), surfaceHeightAt(pos.x, pos.z));
    const clearance = pos.y - groundAhead;
    const minAlt = 170;
    if (clearance < minAlt || pos.y < 140) {
      const urgency = clamp((minAlt - clearance) / minAlt, 0.2, 1);
      desired.normalize().multiplyScalar(1 - urgency);
      desired.y = Math.max(desired.y, 0) + urgency * 2.5;
      aggression = 1.2;
    }
    // Ceiling
    if (pos.y > 2200) desired.y -= 1;
    // Arena boundary: turn back toward centre
    const r = Math.hypot(pos.x, pos.z);
    if (r > 3300) {
      desired.addScaledVector(_d.set(-pos.x, 0, -pos.z).normalize(), (r - 3300) / 300);
    }

    steerToward(fl, desired, aggression, fl.input);
    fl.input.boost = boost;

    // Weapons
    if (tAlive && this.state !== 'extend') {
      _to.copy(target.flight.position).sub(pos);
      const cos = fwd.dot(_to.normalize());
      const gunCone = 0.993 - this.skill * 0.004;
      if (dist < 850 && cos > gunCone && this.fireCooldown <= 0) {
        this.wantFire = true;
        if (this.rng() < dt * 1.2) this.fireCooldown = 0.8 + this.rng() * (1.6 - this.skill);
      }
      if (self.canMissile && dist < 1600 && dist > 350 && cos > 0.9 && this.missileCooldown <= 0) {
        this.wantMissile = true;
        this.missileCooldown = 9 + this.rng() * 7 - this.skill * 3;
      }
    }
  }
}
