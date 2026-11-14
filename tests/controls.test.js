import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { FlightModel } from '../src/engine/flight.js';
import {
  ControlScheme, MouseButtons, applyWheel, sanitizeSettings,
  ZOOM_MIN, ZOOM_MAX, SENS_MIN, SENS_MAX, RAD_PER_PX, LOOK_MAX_YAW,
} from '../src/engine/controls.js';
import { isFormField } from '../src/engine/input.js';

const DT = 1 / 60;
const NONE = { pitch: 0, roll: 0, yaw: 0, stick: false };
const base = { back: 30, high: 7.5, ahead: 60 };
const pose = () => ({ pos: new Vector3(), look: new Vector3(), up: new Vector3() });

function makeFlight() {
  const f = new FlightModel();
  f.reset(new Vector3(0, 1200, 0), 0, 170);
  return f;
}
/** run the scheme + flight model together for `seconds` */
function fly(scheme, f, seconds, manual = NONE, perFrame) {
  for (let t = 0; t < seconds; t += DT) {
    if (perFrame) perFrame();
    const c = scheme.update(DT, f, manual);
    f.input.pitch = c.pitch;
    f.input.roll = c.roll;
    f.input.yaw = c.yaw;
    f.update(DT);
  }
}
const headingDelta = (a, b) => ((b - a + 540) % 360) - 180;

describe('settings', () => {
  it('sanitises mode, sensitivity bounds and invert flag', () => {
    expect(sanitizeSettings({ mode: 'bogus' }).mode).toBe('mouseAim');
    expect(sanitizeSettings({ sensitivity: 99 }).sensitivity).toBe(SENS_MAX);
    expect(sanitizeSettings({ sensitivity: 0 }).sensitivity).toBe(SENS_MIN);
    expect(sanitizeSettings({ sensitivity: 'x' }).sensitivity).toBe(1);
    expect(sanitizeSettings({ invertY: 1 }).invertY).toBe(true);
  });
});

describe('mouse buttons', () => {
  it('LEFT is held/continuous, RIGHT and MIDDLE are single edges', () => {
    const b = new MouseButtons();
    b.down(0);
    expect(b.fire).toBe(true);
    b.down(0); // repeated down while held: still one hold, no edge
    expect(b.take()).toEqual([]);
    expect(b.fire).toBe(true);
    b.up(0);
    expect(b.fire).toBe(false);
    b.down(2);
    b.down(2); // held right button does not re-fire
    expect(b.take()).toEqual(['missile']);
    expect(b.take()).toEqual([]); // consumed once
    b.up(2);
    b.down(2);
    b.down(1);
    expect(b.take()).toEqual(['missile', 'target']);
  });
  it('clear() drops held fire and pending edges', () => {
    const b = new MouseButtons();
    b.down(0); b.down(2);
    b.clear();
    expect(b.fire).toBe(false);
    expect(b.take()).toEqual([]);
  });
});

describe('capture click', () => {
  it('first click in a mouse-view preset only captures and never fires', () => {
    const s = new ControlScheme({ mode: 'mouseAim' });
    expect(s.mouseDown(0)).toBe('capture');
    expect(s.buttons.fire).toBe(false);
    s.setCaptured(true);
    expect(s.mouseDown(0)).toBe('ok');
    expect(s.buttons.fire).toBe(true);
  });
  it('classic needs no capture: clicks act immediately', () => {
    const s = new ControlScheme({ mode: 'classic' });
    expect(s.mouseDown(2)).toBe('ok');
    expect(s.buttons.take()).toEqual(['missile']);
  });
});

describe('wheel zoom', () => {
  it('zooms in/out and is always bounded', () => {
    expect(applyWheel(1, 100)).toBeGreaterThan(1);
    expect(applyWheel(1, -100)).toBeLessThan(1);
    let z = 1;
    for (let i = 0; i < 100; i++) z = applyWheel(z, 500);
    expect(z).toBe(ZOOM_MAX);
    for (let i = 0; i < 100; i++) z = applyWheel(z, -500);
    expect(z).toBe(ZOOM_MIN);
    expect(applyWheel(1, NaN)).toBe(1);
  });
  it('zoom changes the chase camera distance', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'classic' });
    const near = s.cameraPose(f, base, pose()).pos.distanceTo(f.position);
    for (let i = 0; i < 10; i++) s.wheel(400);
    const far = s.cameraPose(f, base, pose()).pos.distanceTo(f.position);
    expect(far).toBeGreaterThan(near * 1.5);
  });
});

describe('mouse aim', () => {
  it('mouse right turns the camera and then the aircraft heading right', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE); // sync aim to the nose
    const camBefore = s.cameraPose(f, base, pose());
    const lookBefore = camBefore.look.clone().sub(camBefore.pos).normalize();
    const h0 = f.getHeading();
    s.mouseMove(300, 0); // ~38 degrees at sensitivity 1
    s.update(DT, f, NONE);
    const camAfter = s.cameraPose(f, base, pose());
    const lookAfter = camAfter.look.clone().sub(camAfter.pos).normalize();
    expect(lookAfter.angleTo(lookBefore)).toBeGreaterThan(0.3); // camera follows the aim immediately
    fly(s, f, 6);
    expect(headingDelta(h0, f.getHeading())).toBeGreaterThan(25); // aircraft turned right towards the aim
  });

  it('converges to the aim and holds heading when the mouse stops (no endless turn)', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE);
    s.mouseMove(250, 0);
    fly(s, f, 8); // converge
    const aimHeading = (Math.atan2(s.aimDir.x, -s.aimDir.z) * 180) / Math.PI;
    const h1 = f.getHeading();
    expect(Math.abs(headingDelta(aimHeading, h1))).toBeLessThan(4);
    fly(s, f, 6); // no further mouse input
    const h2 = f.getHeading();
    expect(Math.abs(headingDelta(h1, h2))).toBeLessThan(2);
    expect(Math.abs(f.getBank())).toBeLessThan(0.15);
  });

  it('mouse up raises the aim (climb) by default; invertY flips it', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE);
    s.mouseMove(0, -200); // mouse up
    s.update(DT, f, NONE);
    expect(s.aimDir.y).toBeGreaterThan(0.2);
    const g = makeFlight();
    const inv = new ControlScheme({ mode: 'mouseAim', invertY: true });
    inv.setCaptured(true);
    inv.update(DT, g, NONE);
    inv.mouseMove(0, -200);
    inv.update(DT, g, NONE);
    expect(inv.aimDir.y).toBeLessThan(-0.2);
  });

  it('sensitivity scales the aim rotation', () => {
    const turn = (sens) => {
      const f = makeFlight();
      const s = new ControlScheme({ mode: 'mouseAim', sensitivity: sens });
      s.setCaptured(true);
      s.update(DT, f, NONE);
      s.mouseMove(100, 0);
      s.update(DT, f, NONE);
      return Math.acos(Math.min(1, s.aimDir.dot(new Vector3(0, 0, -1))));
    };
    expect(turn(1)).toBeCloseTo(100 * RAD_PER_PX, 3);
    expect(turn(2)).toBeCloseTo(2 * turn(1), 3);
  });

  it('aim offset from the nose stays bounded', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE);
    s.mouseMove(5000, 0);
    s.update(DT, f, NONE);
    const off = s.aimDir.angleTo(f.getForward(new Vector3()));
    expect(off).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-3);
  });

  it('pointer-lock fallback: absolute cursor changes act once; a still cursor stabilises', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(false); // lock denied -> fallback
    s.update(DT, f, NONE);
    s.cursorMove(800, 400);
    s.cursorMove(950, 400); // moved 150 px right, then held off-centre
    fly(s, f, 7);
    const h1 = f.getHeading();
    // cursor reported again at the same off-centre spot: no delta, no endless turn
    fly(s, f, 5, NONE, () => s.cursorMove(950, 400));
    expect(Math.abs(headingDelta(h1, f.getHeading()))).toBeLessThan(2);
    expect(h1).toBeGreaterThan(5);
  });

  it('keyboard roll assist overrides the computed roll', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE);
    const c = s.update(DT, f, { pitch: 0, roll: -1, yaw: 0, stick: false });
    expect(c.roll).toBe(-1);
  });

  it('a gamepad/touch stick overrides mouse aim and re-syncs the aim to the nose', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.update(DT, f, NONE);
    s.mouseMove(300, 0);
    const c = s.update(DT, f, { pitch: 0.5, roll: 0, yaw: 0, stick: true });
    expect(c).toEqual({ pitch: 0.5, roll: 0, yaw: 0 });
    expect(s.aimDir.angleTo(f.getForward(new Vector3()))).toBeLessThan(1e-6);
  });
});

describe('free look', () => {
  it('mouse rotates the camera only; aircraft controls are unchanged', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'freeLook' });
    s.setCaptured(true);
    const camBefore = s.cameraPose(f, base, pose()).pos.clone();
    s.mouseMove(600, -150);
    const c = s.update(DT, f, NONE);
    expect(c).toEqual({ pitch: 0, roll: 0, yaw: 0 }); // the mouse never steers
    expect(s.look.yaw).toBeLessThan(-0.5);
    const camAfter = s.cameraPose(f, base, pose()).pos;
    expect(camAfter.distanceTo(camBefore)).toBeGreaterThan(10);
    const h0 = f.getHeading();
    fly(s, f, 3, NONE, () => s.mouseMove(40, 0));
    expect(Math.abs(headingDelta(h0, f.getHeading()))).toBeLessThan(0.5);
  });

  it('keyboard still flies the aircraft in free look', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'freeLook' });
    const c = s.update(DT, f, { pitch: 0, roll: 1, yaw: 0, stick: false });
    expect(c.roll).toBe(1);
  });

  it('view yaw is bounded and recentres after the mouse stops', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'freeLook' });
    s.setCaptured(true);
    s.mouseMove(100000, 0);
    s.update(DT, f, NONE);
    expect(Math.abs(s.look.yaw)).toBeLessThanOrEqual(LOOK_MAX_YAW + 1e-9);
    for (let t = 0; t < 6; t += DT) s.update(DT, f, NONE);
    expect(Math.abs(s.look.yaw)).toBeLessThan(0.05);
  });
});

describe('classic', () => {
  it('passes keyboard stick through and ignores mouse motion', () => {
    const f = makeFlight();
    const s = new ControlScheme({ mode: 'classic' });
    s.setCaptured(true);
    s.mouseMove(500, 500);
    const c = s.update(DT, f, { pitch: 1, roll: -0.5, yaw: 0.2, stick: false });
    expect(c).toEqual({ pitch: 1, roll: -0.5, yaw: 0.2 });
    const p = s.cameraPose(f, base, pose());
    expect(p.pos.distanceTo(f.position)).toBeGreaterThan(29);
    expect(p.pos.clone().sub(f.position).normalize().dot(f.getForward(new Vector3()))).toBeLessThan(-0.9);
  });
});

describe('pause / mode switch clear input', () => {
  it('setSettings clears held fire, pending edges and mouse delta', () => {
    const s = new ControlScheme({ mode: 'classic' });
    s.mouseDown(0); s.mouseDown(2);
    s.dx = 50;
    s.setSettings({ mode: 'freeLook' });
    expect(s.buttons.fire).toBe(false);
    expect(s.buttons.take()).toEqual([]);
    expect(s.dx).toBe(0);
    expect(s.mode).toBe('freeLook');
  });
  it('release() (pause / unlock / blur) drops capture and held fire', () => {
    const s = new ControlScheme({ mode: 'mouseAim' });
    s.setCaptured(true);
    s.mouseDown(0);
    s.release();
    expect(s.captured).toBe(false);
    expect(s.buttons.fire).toBe(false);
    expect(s.mouseDown(0)).toBe('capture'); // next click captures again, does not fire
  });
});

describe('form fields keep native keys', () => {
  it('detects inputs/selects/textareas/contenteditable', () => {
    expect(isFormField({ tagName: 'INPUT' })).toBe(true);
    expect(isFormField({ tagName: 'select' })).toBe(true);
    expect(isFormField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isFormField({ tagName: 'BUTTON' })).toBe(false);
    expect(isFormField(null)).toBe(false);
  });
});
