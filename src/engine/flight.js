// Arcade flight model shared by the player and enemy aircraft.
// Local axes: forward = -Z, up = +Y, right = +X.
import { Vector3, Quaternion } from 'three';
import { clamp, damp } from './util.js';

const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _v = new Vector3();
const _r = new Vector3();
const _u = new Vector3();

export const DEFAULT_FLIGHT = {
  cruiseSpeed: 150, // m/s
  boostSpeed: 265,
  minSpeed: 70,
  maxSpeed: 330,
  pitchRate: 1.45, // rad/s at full input
  rollRate: 2.9,
  yawRate: 0.55,
  bankTurn: 0.85, // coordinated-turn yaw from bank angle
  autoLevel: 1.6, // roll assist strength when stick released
  boostDrain: 0.28, // energy / s
  boostRegen: 0.13,
  accel: 0.55, // speed approach rate
};

export class FlightModel {
  constructor(params = {}) {
    this.p = { ...DEFAULT_FLIGHT, ...params };
    this.position = new Vector3();
    this.quaternion = new Quaternion();
    this.velocity = new Vector3();
    this.speed = this.p.cruiseSpeed;
    this.boostEnergy = 1;
    this.boosting = false;
    this.gForce = 1;
    this.input = { pitch: 0, roll: 0, yaw: 0, boost: false };
    this.assist = true;
  }

  reset(position, yaw = 0, speed = this.p.cruiseSpeed) {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(AY, yaw);
    this.speed = speed;
    this.boostEnergy = 1;
    this.boosting = false;
    this.getForward(this.velocity).multiplyScalar(speed);
  }

  getForward(out = new Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }
  getUp(out = new Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }
  getRight(out = new Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  /** Signed bank angle (rad), positive = right wing down. */
  getBank() {
    const right = this.getRight(_r);
    const up = this.getUp(_u);
    return Math.atan2(-right.y, up.y);
  }

  /** Heading in degrees, 0 = north (-Z), clockwise. */
  getHeading() {
    const f = this.getForward(_v);
    let h = (Math.atan2(f.x, -f.z) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  }

  update(dt) {
    const p = this.p;
    const inp = this.input;
    const pitchIn = clamp(inp.pitch, -1, 1);
    const rollIn = clamp(inp.roll, -1, 1);
    const yawIn = clamp(inp.yaw, -1, 1);

    // Control authority falls off when slow (arcade stall feel).
    const authority = clamp((this.speed - p.minSpeed * 0.6) / (p.cruiseSpeed - p.minSpeed * 0.6), 0.35, 1.15);

    let pitch = pitchIn * p.pitchRate * authority;
    let roll = rollIn * p.rollRate * authority;
    let yaw = yawIn * p.yawRate;

    const bank = this.getBank();
    let turn = 0;
    if (this.assist) {
      // Wings-level assist when no roll input.
      if (Math.abs(rollIn) < 0.05) roll += -bank * p.autoLevel * (Math.abs(bank) > 1.9 ? 0.25 : 1);
      // Coordinated turn: bank swings the nose around the world vertical,
      // so a simple bank turns the aircraft without losing altitude.
      const fy = this.getForward(_v).y;
      turn = Math.sin(bank) * p.bankTurn * authority * (1 - Math.abs(fy) * 0.8);
    }

    // Apply local rotations (pitch about +X, roll about -Z for right, yaw about -Y for right).
    _q.setFromAxisAngle(AX, pitch * dt);
    this.quaternion.multiply(_q);
    _q.setFromAxisAngle(AZ, -roll * dt);
    this.quaternion.multiply(_q);
    _q.setFromAxisAngle(AY, -yaw * dt);
    this.quaternion.multiply(_q);
    if (turn !== 0) {
      _q.setFromAxisAngle(WORLD_UP, -turn * dt);
      this.quaternion.premultiply(_q);
    }
    this.quaternion.normalize();

    // Boost energy.
    this.boosting = !!inp.boost && this.boostEnergy > 0.02;
    if (this.boosting) this.boostEnergy = Math.max(0, this.boostEnergy - p.boostDrain * dt);
    else this.boostEnergy = Math.min(1, this.boostEnergy + p.boostRegen * dt);

    // Speed: approach target, trade with climb/dive.
    const fwd = this.getForward(_v);
    const target = this.boosting ? p.boostSpeed : p.cruiseSpeed;
    this.speed += (target - this.speed) * damp(p.accel, dt);
    this.speed += -fwd.y * 38 * dt; // gravity along flight path
    this.speed = clamp(this.speed, p.minSpeed, p.maxSpeed);

    // Velocity follows the nose; add a sink when slow.
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    const sink = clamp((p.minSpeed + 25 - this.speed) / 25, 0, 1) * 18;
    this.velocity.y -= sink;
    this.position.addScaledVector(this.velocity, dt);

    this.gForce = 1 + Math.abs(pitch) * this.speed / 9.81 * 0.5;
    return this;
  }
}

export { WORLD_UP };
