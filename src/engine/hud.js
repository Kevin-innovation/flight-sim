// In-world HUD drawn on a 2D canvas overlay: boresight, flight-path marker,
// pitch ladder, target boxes (amber), lead pipper, lock ring, missile markers.
import { Vector3 } from 'three';

const CYAN = 'rgba(120, 235, 255, 0.92)';
const CYAN_DIM = 'rgba(120, 235, 255, 0.45)';
const AMBER = 'rgba(255, 184, 64, 0.95)';
const AMBER_DIM = 'rgba(255, 184, 64, 0.55)';
const RED = 'rgba(255, 70, 60, 0.95)';
const _v = new Vector3();
const _v2 = new Vector3();

export class HudOverlay {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sim-hud-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = 1;
    this.visible = true;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w;
    this.h = h;
  }

  dispose() {
    this.canvas.remove();
  }

  /** project world point -> {x,y,on} in CSS px */
  project(camera, p) {
    _v.copy(p).project(camera);
    const behind = _v.z > 1;
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, behind, on: !behind && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 };
  }

  draw(camera, core, view) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.visible || core.status !== 'playing') return;
    const pl = core.player;
    const fl = pl.flight;
    const W = this.w, H = this.h;
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) / 720;
    g.lineWidth = Math.max(1.2, 1.6 * scale);
    g.font = `${Math.round(12 * Math.max(scale, 0.85))}px "Rajdhani", "Segoe UI", sans-serif`;
    g.textBaseline = 'middle';

    const controls = view && view.controls;
    let bx = cx, by = cy;
    if (pl.alive) {
      // Gun boresight = where the nose points (not the screen centre: mouse aim
      // and free look move the camera away from the nose).
      _v.copy(fl.position).addScaledVector(fl.getForward(_v2), 1500);
      const bs = this.project(camera, _v);
      if (bs.on) { bx = bs.x; by = bs.y; }
      // Pitch ladder: rotated with bank, centred on the boresight
      const fovRad = (camera.fov * Math.PI) / 180;
      const pxPerRad = H / 2 / Math.tan(fovRad / 2);
      const fwd = fl.getForward(_v);
      const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      const bank = fl.getBank();
      g.save();
      g.translate(bx, by);
      g.rotate(-bank);
      g.strokeStyle = CYAN_DIM;
      g.fillStyle = CYAN_DIM;
      g.textAlign = 'left';
      for (let deg = -80; deg <= 80; deg += 10) {
        const off = (pitch - (deg * Math.PI) / 180) * pxPerRad;
        if (Math.abs(off) > H * 0.36) continue;
        const half = deg === 0 ? 150 * scale : 60 * scale;
        const gap = 34 * scale;
        g.setLineDash(deg < 0 ? [6 * scale, 5 * scale] : []);
        g.beginPath();
        g.moveTo(-half - gap, off); g.lineTo(-gap, off);
        g.moveTo(gap, off); g.lineTo(gap + half, off);
        g.stroke();
        if (deg !== 0) g.fillText(String(deg), gap + half + 6, off);
      }
      g.setLineDash([]);
      g.restore();

      // Boresight (gun cross)
      g.strokeStyle = CYAN;
      g.beginPath();
      const b = 10 * scale;
      g.moveTo(bx - b * 2.2, by); g.lineTo(bx - b, by);
      g.moveTo(bx + b, by); g.lineTo(bx + b * 2.2, by);
      g.moveTo(bx, by - b * 2); g.lineTo(bx, by - b);
      g.stroke();
      g.beginPath();
      g.arc(bx, by, 2 * scale, 0, Math.PI * 2);
      g.stroke();

      // Mouse-aim reticle: white ring with gap ticks, distinct from the gun cross
      if (controls && controls.mode === 'mouseAim' && controls.captured) {
        _v.copy(fl.position).addScaledVector(controls.aimDir, 1500);
        const ap = this.project(camera, _v);
        if (ap.on) {
          const r = 16 * scale;
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.lineWidth = 2 * scale;
          for (let i = 0; i < 4; i++) {
            const a0 = (i * Math.PI) / 2 + 0.25;
            g.beginPath();
            g.arc(ap.x, ap.y, r, a0, a0 + Math.PI / 2 - 0.5);
            g.stroke();
          }
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.beginPath();
          g.arc(ap.x, ap.y, 1.8 * scale, 0, Math.PI * 2);
          g.fill();
          // tether from nose to aim while the aircraft catches up
          const dd = Math.hypot(ap.x - bx, ap.y - by);
          if (dd > r * 1.5) {
            g.setLineDash([4 * scale, 6 * scale]);
            g.strokeStyle = 'rgba(255,255,255,0.35)';
            g.lineWidth = 1 * scale;
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(ap.x, ap.y);
            g.stroke();
            g.setLineDash([]);
          }
        }
      }
      if (controls && controls.mode === 'freeLook' && (controls.look.yaw !== 0 || controls.look.pitch !== 0)) {
        g.fillStyle = CYAN_DIM;
        g.textAlign = 'center';
        g.fillText('FREE LOOK', cx, H * 0.16);
      }

      // Flight-path marker
      _v.copy(fl.position).addScaledVector(fl.velocity, 4);
      const fp = this.project(camera, _v);
      if (fp.on) {
        g.beginPath();
        g.arc(fp.x, fp.y, 7 * scale, 0, Math.PI * 2);
        g.moveTo(fp.x - 16 * scale, fp.y); g.lineTo(fp.x - 7 * scale, fp.y);
        g.moveTo(fp.x + 7 * scale, fp.y); g.lineTo(fp.x + 16 * scale, fp.y);
        g.moveTo(fp.x, fp.y - 7 * scale); g.lineTo(fp.x, fp.y - 13 * scale);
        g.stroke();
      }
    }

    // Enemies
    for (const e of core.enemies) {
      if (!e.alive) continue;
      const isT = e === pl.target;
      const p = this.project(camera, e.flight.position);
      const d = e.flight.position.distanceTo(fl.position);
      if (p.on) {
        const s = Math.max(14, Math.min(46, 3200 / Math.max(d, 1) * 6)) * scale;
        g.strokeStyle = isT ? AMBER : AMBER_DIM;
        g.lineWidth = (isT ? 2 : 1.3) * scale;
        if (isT) {
          // corner brackets
          const k = s * 0.45;
          g.beginPath();
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            g.moveTo(p.x + sx * s, p.y + sy * (s - k));
            g.lineTo(p.x + sx * s, p.y + sy * s);
            g.lineTo(p.x + sx * (s - k), p.y + sy * s);
          }
          g.stroke();
          g.fillStyle = AMBER;
          g.textAlign = 'left';
          g.fillText(`${e.callsign}`, p.x + s + 6, p.y - 8 * scale);
          g.fillText(`${(d / 1000).toFixed(2)} km`, p.x + s + 6, p.y + 8 * scale);
          // health bar
          g.fillStyle = 'rgba(255,184,64,0.25)';
          g.fillRect(p.x - s, p.y + s + 5 * scale, s * 2, 3 * scale);
          g.fillStyle = AMBER;
          g.fillRect(p.x - s, p.y + s + 5 * scale, s * 2 * (e.hp / e.maxHp), 3 * scale);
          // lock ring
          if (pl.lockProgress > 0) {
            const locked = pl.locked;
            g.strokeStyle = locked ? RED : AMBER;
            g.lineWidth = 2 * scale;
            const rr = s * (1.25 + (1 - pl.lockProgress) * 1.6);
            g.beginPath();
            g.arc(p.x, p.y, rr, 0, Math.PI * 2 * Math.max(0.08, pl.lockProgress));
            g.stroke();
            if (locked) {
              g.fillStyle = RED;
              g.textAlign = 'center';
              g.fillText('LOCK', p.x, p.y - rr - 10 * scale);
            }
          }
          // gun lead pipper
          const tof = d / 1050;
          _v.copy(e.flight.position).addScaledVector(e.flight.velocity, tof).addScaledVector(fl.velocity, -tof * 0.15);
          const lp = this.project(camera, _v);
          if (lp.on && d < 1600) {
            g.strokeStyle = AMBER;
            g.lineWidth = 1.5 * scale;
            g.beginPath();
            g.arc(lp.x, lp.y, 9 * scale, 0, Math.PI * 2);
            g.moveTo(lp.x + 2 * scale, lp.y); g.arc(lp.x, lp.y, 2 * scale, 0, Math.PI * 2);
            g.stroke();
          }
        } else {
          g.beginPath();
          g.moveTo(p.x, p.y - s * 0.5); g.lineTo(p.x + s * 0.5, p.y); g.lineTo(p.x, p.y + s * 0.5); g.lineTo(p.x - s * 0.5, p.y); g.closePath();
          g.stroke();
        }
      } else if (isT) {
        this.edgeArrow(g, p, cx, cy, W, H, AMBER, scale, `${(d / 1000).toFixed(1)}km`);
      }
    }

    // Incoming missiles
    for (const m of core.missiles) {
      if (!m.active || m.team !== 'enemy') continue;
      const p = this.project(camera, m.pos);
      if (p.on) {
        g.strokeStyle = RED;
        g.lineWidth = 2 * scale;
        g.beginPath();
        g.arc(p.x, p.y, 10 * scale, 0, Math.PI * 2);
        g.stroke();
      } else this.edgeArrow(g, p, cx, cy, W, H, RED, scale, 'MSL');
    }

    // Damage vignette
    if (pl.damageFlash > 0) {
      const a = Math.min(0.55, pl.damageFlash * 1.6);
      const grd = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.7);
      grd.addColorStop(0, 'rgba(255,30,20,0)');
      grd.addColorStop(1, `rgba(255,30,20,${a})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }
  }

  edgeArrow(g, p, cx, cy, W, H, color, scale, label) {
    let dx = p.x - cx, dy = p.y - cy;
    if (p.behind) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    const r = Math.min(W, H) * 0.38;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(14 * scale, 0); g.lineTo(-6 * scale, -9 * scale); g.lineTo(-6 * scale, 9 * scale); g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.fillText(label, x - Math.cos(ang) * 22 * scale, y - Math.sin(ang) * 22 * scale);
  }
}
