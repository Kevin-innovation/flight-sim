// Unified input: keyboard + gamepad (standard mapping) + external setInput
// (touch UI). Gameplay reads only the resulting actions.
import { clamp } from './util.js';

const KEYMAP = {
  KeyW: ['pitch', -1], ArrowUp: ['pitch', -1],
  KeyS: ['pitch', 1], ArrowDown: ['pitch', 1],
  KeyA: ['roll', -1], ArrowLeft: ['roll', -1],
  KeyD: ['roll', 1], ArrowRight: ['roll', 1],
  KeyQ: ['yaw', -1], KeyE: ['yaw', 1],
};
const BUTTON_KEYS = {
  ShiftLeft: 'boost', ShiftRight: 'boost',
  Space: 'fire', KeyJ: 'fire',
  KeyM: 'missile', KeyF: 'missile', KeyK: 'missile',
  KeyC: 'camera',
  KeyT: 'target', KeyR: 'target', Tab: 'target',
  KeyP: 'pause', Escape: 'pause',
};

/** Radial deadzone (0.15) with rescale to 0..1, per Patch controller guidance. */
export function applyDeadzone(x, y, dz = 0.15) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

export class InputManager {
  constructor({ padEnabled = true } = {}) {
    this.keys = new Set();
    this.analog = { pitch: 0, roll: 0, yaw: 0 }; // from touch
    this.buttons = { fire: false, boost: false }; // from touch
    this.pressQueue = []; // edge actions: missile, camera, target, pause
    this.padEnabled = padEnabled;
    this.padPrev = [];
    this.device = 'keyboard';
    this.padState = { pitch: 0, roll: 0, yaw: 0, fire: false, boost: false };
    this.onKeyDown = (e) => {
      if (e.repeat) { if (KEYMAP[e.code] || BUTTON_KEYS[e.code]) e.preventDefault(); return; }
      const btn = BUTTON_KEYS[e.code];
      if (KEYMAP[e.code] || btn) e.preventDefault();
      this.device = 'keyboard';
      this.keys.add(e.code);
      if (btn && btn !== 'fire' && btn !== 'boost') this.pressQueue.push(btn);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  clear() {
    this.keys.clear();
    this.analog.pitch = this.analog.roll = this.analog.yaw = 0;
    this.buttons.fire = this.buttons.boost = false;
    this.pressQueue.length = 0;
  }

  /** External (touch / UI) input. Axes are -1..1, buttons boolean. */
  set(action, value) {
    if (action in this.analog) this.analog[action] = clamp(Number(value) || 0, -1, 1);
    else if (action === 'fire' || action === 'boost') this.buttons[action] = !!value;
    else if (value) this.pressQueue.push(action); // missile/camera/target/pause
    if (action !== 'pause') this.device = 'touch';
  }

  pollGamepad() {
    const ps = this.padState;
    ps.pitch = ps.roll = ps.yaw = 0;
    ps.fire = ps.boost = false;
    if (!this.padEnabled || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || pad.mapping !== 'standard') continue;
      const b = pad.buttons;
      const prev = this.padPrev;
      const pressed = (i) => b[i] && b[i].pressed && !prev[i];
      const [lx, ly] = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0);
      const [rx] = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0);
      ps.roll = Math.sign(lx) * lx * lx;
      ps.pitch = Math.sign(ly) * ly * ly; // pull back (down) = nose up
      ps.yaw = Math.sign(rx) * rx * rx;
      if (b[14]?.pressed) ps.yaw = -1; // d-pad left/right also yaw
      if (b[15]?.pressed) ps.yaw = 1;
      ps.fire = (b[7]?.value || 0) > 0.3 || !!b[2]?.pressed;
      ps.boost = (b[6]?.value || 0) > 0.3 || !!b[10]?.pressed;
      if (pressed(0) || pressed(4)) this.pressQueue.push('missile');
      if (pressed(5) || pressed(1)) this.pressQueue.push('target');
      if (pressed(3)) this.pressQueue.push('camera');
      if (pressed(9)) this.pressQueue.push('pause');
      const any = b.some((x) => x.pressed) || Math.hypot(pad.axes[0], pad.axes[1]) > 0.5;
      if (any) this.device = 'gamepad';
      this.padPrev = b.map((x) => x.pressed);
      this.pad = pad;
      return;
    }
  }

  rumble(strong = 0.6, weak = 0.3, duration = 120) {
    const act = this.pad && this.pad.vibrationActuator;
    if (act && act.playEffect) act.playEffect('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }

  axis(name) {
    let v = 0;
    for (const [code, [act, dir]] of Object.entries(KEYMAP)) if (act === name && this.keys.has(code)) v += dir;
    return clamp(v + this.analog[name] + this.padState[name], -1, 1);
  }

  button(name) {
    for (const [code, act] of Object.entries(BUTTON_KEYS)) if (act === name && this.keys.has(code)) return true;
    return this.buttons[name] || this.padState[name];
  }

  takePresses() {
    const q = this.pressQueue.slice();
    this.pressQueue.length = 0;
    return q;
  }

  anyKeyHeld() {
    return this.keys.size > 0;
  }
}
