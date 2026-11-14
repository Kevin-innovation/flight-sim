// Desktop control presets (pure, DOM-free so they can be unit tested):
//   mouseAim  - mouse moves an aim direction; the aircraft banks/pulls to follow it,
//               the camera looks along the aim. Keyboard A/D, Q/E (and W/S) assist.
//   classic   - keyboard stick (WASD/arrows pitch+roll, Q/E yaw), chase camera.
//   freeLook  - keyboard flies; the mouse only orbits the camera around the jet.
// Mouse buttons in every preset during active play: LEFT hold = cannon,
// RIGHT press = missile, MIDDLE press = next target, WHEEL = chase zoom.
import { Vector3, Quaternion } from 'three';
import { clamp } from './util.js';
import { steerToward } from './ai.js';
import { chaseTarget, chaseLookAt } from './camera.js';

export const MODES = ['mouseAim', 'classic', 'freeLook'];
export const MODE_LABELS = { mouseAim: '마우스 조준', classic: '키보드 클래식', freeLook: '자유 시점' };
export const DEFAULT_SETTINGS = Object.freeze({ mode: 'mouseAim', sensitivity: 1, invertY: false });
export const SENS_MIN = 0.2;
export const SENS_MAX = 3;
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;
/** radians of aim/look per mouse pixel at sensitivity 1 */
export const RAD_PER_PX = 0.0022;
const AIM_MAX_OFF_NOSE = (80 * Math.PI) / 180;
const AIM_MAX_PITCH = (80 * Math.PI) / 180;
export const LOOK_MAX_YAW = (150 * Math.PI) / 180;
export const LOOK_MAX_PITCH_UP = (60 * Math.PI) / 180;
export const LOOK_MAX_PITCH_DOWN = (45 * Math.PI) / 180;
const LOOK_RECENTER_AFTER = 2.5; // s without mouse movement

const WORLD_UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();

export function sanitizeSettings(s = {}) {
  const mode = MODES.includes(s.mode) ? s.mode : DEFAULT_SETTINGS.mode;
  const sens = Number(s.sensitivity);
  return {
    mode,
    sensitivity: Number.isFinite(sens) ? clamp(sens, SENS_MIN, SENS_MAX) : DEFAULT_SETTINGS.sensitivity,
    invertY: !!s.invertY,
  };
}

/** Wheel zoom: positive deltaY (scroll down) zooms out; always within [ZOOM_MIN, ZOOM_MAX]. */
export function applyWheel(zoom, deltaY) {
  const d = clamp(Number(deltaY) || 0, -600, 600);
  return clamp(zoom * Math.exp(d * 0.0012), ZOOM_MIN, ZOOM_MAX);
}

/** Mouse button semantics: LEFT is held (continuous), RIGHT / MIDDLE are single edges. */
export class MouseButtons {
  constructor() {
    this.held = new Set();
    this.edges = [];
  }
  down(button) {
    if (this.held.has(button)) return;
    this.held.add(button);
    if (button === 2) this.edges.push('missile');
    else if (button === 1) this.edges.push('target');
  }
  up(button) {
    this.held.delete(button);
  }
  get fire() {
    return this.held.has(0);
  }
  take() {
    const e = this.edges.slice();
    this.edges.length = 0;
    return e;
  }
  clear() {
    this.held.clear();
    this.edges.length = 0;
  }
}

export class ControlScheme {
  constructor(settings = DEFAULT_SETTINGS) {
    this.settings = sanitizeSettings(settings);
    this.buttons = new MouseButtons();
    this.aimDir = new Vector3(0, 0, -1);
    this.aimSynced = false;
    this.look = { yaw: 0, pitch: 0 };
    this.lookIdle = 0;
    this.zoom = 1;
    this.captured = false; // mouse is driving the view (pointer lock or fallback)
    this.pointerLocked = false;
    this.dx = 0;
    this.dy = 0;
  }

  get mode() {
    return this.settings.mode;
  }

  usesMouseView() {
    return this.settings.mode !== 'classic';
  }

  setSettings(s) {
    const prevMode = this.settings.mode;
    this.settings = sanitizeSettings({ ...this.settings, ...s });
    this.clear();
    if (prevMode !== this.settings.mode) {
      this.look.yaw = this.look.pitch = 0;
      this.aimSynced = false;
    }
    return this.settings;
  }

  /** Drop held buttons, pending edges and pending mouse delta (mode switch, pause, blur). */
  clear() {
    this.buttons.clear();
    this.dx = this.dy = 0;
    this._prevCursor = null;
  }

  /** Mouse capture lost (pause, unlock, blur): next click captures again. */
  release() {
    this.captured = false;
    this.pointerLocked = false;
    this.aimSynced = false;
    this.clear();
  }

  /**
   * Mouse button pressed during active play. Returns 'capture' when this click
   * should only capture the mouse (mouse-view presets not yet captured): it
   * never fires a weapon.
   */
  mouseDown(button) {
    if (this.usesMouseView() && !this.captured) return 'capture';
    this.buttons.down(button);
    return 'ok';
  }

  mouseUp(button) {
    this.buttons.up(button);
  }

  /**
   * Relative mouse motion in CSS pixels (movementX/Y). With pointer lock it is
   * unbounded; if the browser denied the lock the same deltas still arrive while
   * the cursor moves over the page (fallback), so the aim never "keeps turning".
   */
  mouseMove(dx, dy) {
    if (!this.captured || !this.usesMouseView()) return;
    this.dx += dx;
    this.dy += dy;
  }

  /**
   * Fallback when pointer lock was denied: absolute cursor position (CSS px).
   * Only the *change* since the previous position becomes a delta, applied once,
   * so holding the cursor still (even off-centre) leaves the aim where it is.
   */
  cursorMove(x, y) {
    if (!this.captured || this.pointerLocked || !this.usesMouseView()) { this._prevCursor = null; return; }
    if (this._prevCursor) {
      this.dx += x - this._prevCursor.x;
      this.dy += y - this._prevCursor.y;
    }
    this._prevCursor = { x, y };
  }

  wheel(deltaY) {
    this.zoom = applyWheel(this.zoom, deltaY);
    return this.zoom;
  }

  setCaptured(locked) {
    this.captured = true;
    this.pointerLocked = !!locked;
    this.clear();
  }

  /** consume pending mouse delta as radians (sensitivity + invert applied) */
  _consumeDelta() {
    let dx = this.dx, dy = this.dy;
    this.dx = this.dy = 0;
    const k = this.settings.sensitivity * RAD_PER_PX;
    const inv = this.settings.invertY ? -1 : 1;
    return { yaw: -dx * k, pitch: -dy * k * inv, moved: dx !== 0 || dy !== 0 };
  }

  /**
   * Stick inputs for the flight model.
   * @param manual {pitch, roll, yaw, stick} from keyboard/gamepad/touch; `stick` is
   *        true when a gamepad or touch stick is deflected (it overrides mouse aim).
   */
  update(dt, flight, manual) {
    const m = { pitch: manual.pitch || 0, roll: manual.roll || 0, yaw: manual.yaw || 0 };
    const mode = this.settings.mode;
    if (mode === 'classic') {
      this.dx = this.dy = 0;
      return m;
    }
    const d = this._consumeDelta();
    if (mode === 'freeLook') {
      if (d.moved) this.lookIdle = 0;
      else this.lookIdle += dt;
      this.look.yaw = clamp(this.look.yaw + d.yaw, -LOOK_MAX_YAW, LOOK_MAX_YAW);
      this.look.pitch = clamp(this.look.pitch + d.pitch, -LOOK_MAX_PITCH_DOWN, LOOK_MAX_PITCH_UP);
      if (this.lookIdle > LOOK_RECENTER_AFTER) {
        const k = 1 - Math.exp(-2.5 * dt);
        this.look.yaw -= this.look.yaw * k;
        this.look.pitch -= this.look.pitch * k;
      }
      return m; // the mouse never steers the aircraft in free look
    }
    // mouseAim
    if (!this.aimSynced || !this.captured || manual.stick) {
      flight.getForward(this.aimDir);
      this.aimSynced = this.captured;
      if (manual.stick || !this.captured) return m;
    }
    this.rotateAim(d.yaw, d.pitch, flight);
    const out = steerToward(flight, this.aimDir, 1, { pitch: 0, roll: 0, yaw: 0 });
    if (Math.abs(m.roll) > 0.05) out.roll = m.roll;
    if (Math.abs(m.pitch) > 0.05) out.pitch = m.pitch;
    out.yaw = clamp(out.yaw + m.yaw, -1, 1);
    return out;
  }

  /** Rotate the world-space aim by yaw (about world up) and pitch, with bounds. */
  rotateAim(yaw, pitch, flight) {
    const a = this.aimDir;
    if (yaw) a.applyAxisAngle(WORLD_UP, yaw);
    if (pitch) {
      const right = _a.crossVectors(a, WORLD_UP);
      if (right.lengthSq() > 1e-6) a.applyAxisAngle(right.normalize(), pitch);
    }
    // clamp world pitch
    const p = Math.asin(clamp(a.y, -1, 1));
    if (Math.abs(p) > AIM_MAX_PITCH) {
      const h = Math.hypot(a.x, a.z) || 1e-6;
      const cp = Math.cos(AIM_MAX_PITCH);
      a.set((a.x / h) * cp, Math.sign(p) * Math.sin(AIM_MAX_PITCH), (a.z / h) * cp);
    }
    // keep the aim within reach of the nose so the aircraft can catch up
    const fwd = flight.getForward(_b);
    const ang = Math.acos(clamp(a.dot(fwd), -1, 1));
    if (ang > AIM_MAX_OFF_NOSE) {
      const t = AIM_MAX_OFF_NOSE / ang;
      // slerp from nose towards aim by t
      _q.setFromUnitVectors(fwd, a);
      _q2.identity().slerp(_q, t);
      a.copy(fwd).applyQuaternion(_q2);
    }
    a.normalize();
    return a;
  }

  /**
   * Desired camera pose for the active preset.
   * @param base {back, high, ahead} for the selected camera (chase or far)
   * @param out {pos: Vector3, look: Vector3, up: Vector3}
   */
  cameraPose(flight, base, out) {
    const back = base.back * this.zoom;
    const high = base.high * (0.6 + 0.4 * this.zoom);
    const mode = this.settings.mode;
    if (mode === 'mouseAim' && this.captured) {
      out.pos.copy(flight.position).addScaledVector(this.aimDir, -back).addScaledVector(WORLD_UP, high);
      out.look.copy(flight.position).addScaledVector(this.aimDir, base.ahead);
      out.up.copy(WORLD_UP);
    } else if (mode === 'freeLook' && (this.look.yaw !== 0 || this.look.pitch !== 0)) {
      _q.setFromAxisAngle(WORLD_UP, this.look.yaw);
      _q2.setFromAxisAngle(_a.set(1, 0, 0), this.look.pitch);
      _q.multiply(_q2).premultiply(flight.quaternion);
      out.pos.set(0, high, back).applyQuaternion(_q).add(flight.position);
      out.look.set(0, 0, -base.ahead * 0.5).applyQuaternion(_q).add(flight.position);
      out.up.set(0, 1, 0).applyQuaternion(_q);
    } else {
      chaseTarget(flight, back, high, out.pos);
      chaseLookAt(flight, base.ahead, out.look);
      flight.getUp(out.up);
    }
    return out;
  }
}
