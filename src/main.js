// UI shell: screens, menus (keyboard / mouse / touch / gamepad), HUD binding,
// radar, touch controls, best score and audio toggle.
import { FlightSimulation } from './simulation.js';
import { GameAudio } from './audio.js';
import { applyDeadzone } from './engine/input.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const params = new URLSearchParams(location.search);
const TEST = params.get('patch-test') === '1';
const BEST_KEY = 'skyward.best';

const audio = new GameAudio();
let best = 0;
try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* storage blocked */ }

let screen = 'title';
let history = [];
let lastTelemetry = null;
let device = 'keyboard';
let hudChecked = false;

const sim = new FlightSimulation($('#game'), onTelemetry, { audio, testMode: TEST });
window.__skyward = sim; // debugging handle

// ------------------------------------------------------------------ screens
function show(name, push = true) {
  if (push && screen !== name) history.push(screen);
  screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  const playing = name === 'play' || name === 'pause';
  $('#hud').classList.toggle('hidden', !playing);
  $('#touch').classList.toggle('hidden', !(name === 'play' && isTouch()));
  focusFirst();
  if (name === 'controls') renderControls();
}

function back() {
  const prev = history.pop() || 'title';
  show(prev, false);
}

function focusFirst() {
  const s = document.querySelector('.screen.active');
  if (!s) return;
  const b = s.querySelector('.mbtn');
  if (b) b.focus({ preventScroll: true });
}

function isTouch() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function act(action) {
  audio.ensure();
  audio.play('ui');
  switch (action) {
    case 'briefing': show('briefing'); break;
    case 'controls': show('controls'); break;
    case 'credits': show('credits'); break;
    case 'back': back(); break;
    case 'start': startGame(); break;
    case 'resume': resumeGame(); break;
    case 'restart': startGame(); break;
    case 'quit': quit(); break;
    case 'audio': audio.setEnabled(!audio.enabled); syncAudioLabels(); break;
    default: break;
  }
}

function startGame() {
  history = [];
  $('#h-killfeed').innerHTML = '';
  sim.start();
  show('play', false);
}

function pauseGame() {
  if (screen !== 'play') return;
  sim.pause();
  show('pause', false);
}

function resumeGame() {
  sim.resume();
  show('play', false);
}

function quit() {
  sim.pause();
  sim.running = false;
  audio.stopEngine();
  history = [];
  show('title', false);
}

function syncAudioLabels() {
  const txt = `사운드: ${audio.enabled ? '켜짐' : '꺼짐'}`;
  $$('[data-action="audio"]').forEach((b) => (b.textContent = txt));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) act(b.dataset.action);
});
$('#btn-pause').addEventListener('click', () => pauseGame());

// ----------------------------------------------------------- menu keyboard
document.addEventListener('keydown', (e) => {
  audio.ensure();
  if (screen === 'play') return;
  if (e.code === 'KeyP' && screen === 'pause') { resumeGame(); return; }
  menuNav(e.code);
});

function menuNav(code) {
  const s = document.querySelector('.screen.active');
  if (!s) return;
  const items = Array.from(s.querySelectorAll('.mbtn'));
  const i = items.indexOf(document.activeElement);
  if (code === 'ArrowDown' || code === 'ArrowRight' || code === 'KeyS') { items[(i + 1 + items.length) % items.length]?.focus(); }
  else if (code === 'ArrowUp' || code === 'ArrowLeft' || code === 'KeyW') { items[(i - 1 + items.length) % items.length]?.focus(); }
  else if (code === 'Back') { if (screen === 'pause') resumeGame(); else if (screen !== 'title') back(); }
  else if (code === 'Confirm') { (document.activeElement?.closest('.mbtn') || items[0])?.click(); }
}

// ------------------------------------------------------------ menu gamepad
let padPrev = [];
let padHeld = true; // ignore buttons held from before a screen appeared
let axisLatch = 0;
function pollMenuPad() {
  requestAnimationFrame(pollMenuPad);
  if (TEST || !navigator.getGamepads) return;
  const pad = Array.from(navigator.getGamepads()).find((p) => p && p.mapping === 'standard');
  if (!pad) return;
  const b = pad.buttons.map((x) => x.pressed);
  const pressed = (i) => b[i] && !padPrev[i];
  if (b.some(Boolean) || Math.hypot(pad.axes[0], pad.axes[1]) > 0.5) setDevice('gamepad');
  if (screen !== 'play') {
    if (padHeld) { if (!b.some(Boolean)) padHeld = false; }
    else {
      audio.ensure();
      if (pressed(0)) menuNav('Confirm');
      if (pressed(1)) menuNav('Back');
      if (pressed(9) && screen === 'pause') resumeGame();
      if (pressed(12)) menuNav('ArrowUp');
      if (pressed(13)) menuNav('ArrowDown');
      const [, ly] = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, 0.5);
      if (ly !== 0 && axisLatch === 0) menuNav(ly > 0 ? 'ArrowDown' : 'ArrowUp');
      axisLatch = ly === 0 ? 0 : 1;
    }
  } else padHeld = true;
  padPrev = b;
}
requestAnimationFrame(pollMenuPad);

function setDevice(d) {
  if (d === device) return;
  device = d;
  document.body.dataset.device = d;
  const hint = $('#title-hint');
  if (hint) hint.textContent = d === 'gamepad' ? '하단 버튼: 선택 · 오른쪽 버튼: 뒤로' : 'Enter / 클릭으로 선택';
  if (screen === 'controls') renderControls();
}
window.addEventListener('keydown', () => setDevice('keyboard'));
window.addEventListener('pointerdown', (e) => setDevice(e.pointerType === 'touch' ? 'touch' : 'keyboard'));

function renderControls() {
  const rows = {
    keyboard: [
      ['W / ↑', '기수 내림'], ['S / ↓', '기수 올림'], ['A D / ← →', '롤 (자동 선회 보조)'], ['Q / E', '요'],
      ['Shift', '부스트'], ['Space', '기관포'], ['M / F', '미사일 (락온 시 유도)'], ['T / R', '타깃 전환'],
      ['C', '카메라 전환'], ['P', '일시정지'],
    ],
    gamepad: [
      ['왼쪽 스틱', '피치 / 롤'], ['오른쪽 스틱 ↔', '요'], ['오른쪽 트리거', '기관포'], ['왼쪽 트리거', '부스트'],
      ['하단 버튼 / 왼쪽 숄더', '미사일'], ['오른쪽 숄더 / 오른쪽 버튼', '타깃 전환'], ['상단 버튼', '카메라 전환'], ['스타트', '일시정지'],
    ],
    touch: [
      ['왼쪽 스틱', '피치 / 롤'], ['GUN', '기관포 (누르고 있기)'], ['MSL', '미사일'], ['BST', '부스트'],
      ['TGT', '타깃 전환'], ['CAM', '카메라'], ['II', '일시정지'],
    ],
  };
  const d = rows[device] ? device : 'keyboard';
  $('#controls-title').textContent = { keyboard: '키보드', gamepad: '컨트롤러', touch: '터치' }[d];
  $('#controls-table').innerHTML = rows[d].map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('');
}

// ---------------------------------------------------------------- credits
fetch('./assets/patch/credits.json')
  .then((r) => r.json())
  .then((list) => {
    $('#credits-list').innerHTML =
      list.map((c) => `<div class="credit"><b>${esc(c.title)}</b><span>${esc(c.by || '')} · ${esc(c.source || '')} · ${esc(c.license || '')}${c.ai ? ' · AI 생성' : ''}</span></div>`).join('') +
      '<div class="credit"><b>Three.js</b><span>MIT License</span></div><p class="small">모든 3D 모델·HDRI·재질은 Patch(patch.gg) 에셋 라이브러리에서 제공. 전체 크레딧: ASSET_CREDITS.md / CREDITS.md</p>';
  })
  .catch(() => { $('#credits-list').textContent = 'ASSET_CREDITS.md 참조'; });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --------------------------------------------------------------- telemetry
const el = {
  wave: $('#h-wave'), score: $('#h-score'), kills: $('#h-kills'), left: $('#h-left'),
  speed: $('#h-speed'), alt: $('#h-alt'), agl: $('#h-agl'), boost: $('#h-boost'),
  heading: $('#h-heading'), tape: $('#h-heading-tape'),
  health: $('#h-health'), healthNum: $('#h-health-num'),
  ammo: $('#h-ammo'), heat: $('#h-heat'), msl: $('#h-msl'), lock: $('#h-lock'), tgt: $('#h-tgt'),
  message: $('#h-message'), warning: $('#h-warning'), feed: $('#h-killfeed'), loading: $('#h-loading'),
};
const radar = $('#radar');
const rctx = radar.getContext('2d');

function onTelemetry(t) {
  if (t.event) return onEvent(t);
  lastTelemetry = t;
  el.wave.textContent = `${t.wave}/${t.waves}`;
  el.score.textContent = t.score.toLocaleString();
  el.kills.textContent = t.kills;
  el.left.textContent = t.enemiesLeft;
  el.speed.textContent = t.speed;
  el.alt.textContent = t.altitude;
  el.agl.textContent = `AGL ${t.agl}`;
  el.boost.style.height = `${t.boost * 100}%`;
  el.boost.parentElement.classList.toggle('on', t.boosting);
  el.heading.textContent = String(t.heading).padStart(3, '0');
  el.tape.style.backgroundPositionX = `${-t.heading * 4}px`;
  const hp = t.health / t.maxHealth;
  el.health.style.width = `${hp * 100}%`;
  el.health.parentElement.classList.toggle('low', hp < 0.35);
  el.healthNum.textContent = t.health;
  el.ammo.textContent = t.ammo;
  el.heat.style.width = `${t.heat * 100}%`;
  el.heat.parentElement.classList.toggle('over', t.overheated);
  el.msl.textContent = t.missiles;
  el.lock.textContent = t.locked ? 'LOCK' : t.lock > 0 ? `${Math.round(t.lock * 100)}%` : '—';
  el.lock.classList.toggle('locked', t.locked);
  el.tgt.textContent = t.targetName ? `${t.targetName} ${(t.targetDistance / 1000).toFixed(2)}km` : '—';
  el.message.textContent = t.message || '';
  el.message.classList.toggle('show', !!t.message);
  const warn = { pullup: 'PULL UP', boundary: '작전 구역 이탈 — 선회하라', missile: 'MISSILE INCOMING', ceiling: 'ALTITUDE' }[t.warning] || '';
  el.warning.textContent = warn;
  el.warning.classList.toggle('show', !!warn);
  drawRadar(t);
  if (TEST && !hudChecked && t.status === 'playing' && t.speed > 0) { hudChecked = true; console.log('pass hud-updated'); }
}

function onEvent(ev) {
  switch (ev.event) {
    case 'pauseRequested':
      if (screen === 'play') pauseGame();
      else if (screen === 'pause' && ev.reason === 'key') resumeGame();
      break;
    case 'loading':
      $('#load-bar').style.width = `${Math.round(ev.progress * 100)}%`;
      $('#load-label').textContent = `에셋 로딩 중… ${ev.label}`;
      el.loading.textContent = `모델 로딩 중 ${Math.round(ev.progress * 100)}%`;
      break;
    case 'ready':
      $('#load-label').textContent = ev.assets ? 'Patch 에셋 로딩 완료' : '일부 에셋을 불러오지 못했습니다';
      $('#load-bar').style.width = '100%';
      document.body.classList.add('assets-ready');
      el.loading.textContent = '';
      break;
    case 'kill': {
      const d = document.createElement('div');
      d.className = 'feed-item';
      d.innerHTML = `<b>SPLASH</b> ${esc(ev.callsign)} <span>+${ev.points}${ev.combo > 1 ? ` ×${ev.combo} COMBO` : ''}</span>`;
      el.feed.prepend(d);
      setTimeout(() => d.remove(), 4000);
      break;
    }
    case 'gameover':
    case 'victory':
      showResult(ev.event === 'victory', ev);
      break;
    default:
      break;
  }
}

function showResult(victory, ev) {
  const t = lastTelemetry || {};
  const score = ev.score ?? t.score ?? 0;
  const newBest = score > best;
  if (newBest) {
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
  }
  $('#best-score').textContent = best.toLocaleString();
  $('#result-eyebrow').textContent = victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('#result-title').textContent = victory ? '제공권 확보' : ev.reason || '격추됨';
  $('#screen-result').classList.toggle('victory', victory);
  $('#r-score').textContent = score.toLocaleString();
  $('#r-kills').textContent = t.kills ?? 0;
  $('#r-wave').textContent = `${t.wave ?? 1}/${t.waves ?? 5}`;
  $('#r-acc').textContent = `${t.accuracy ?? 0}%`;
  $('#r-best').textContent = best.toLocaleString();
  $('#r-newbest').classList.toggle('hidden', !newBest);
  if (!TEST) show('result', false);
}

function drawRadar(t) {
  const W = radar.width, H = radar.height, cx = W / 2, cy = H / 2, R = W / 2 - 6;
  const g = rctx;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(3, 22, 36, 0.72)';
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(110, 230, 255, 0.35)';
  g.lineWidth = 1;
  for (const r of [R, R * 0.66, R * 0.33]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();
  // player
  g.fillStyle = 'rgba(140, 240, 255, 1)';
  g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy + 5); g.lineTo(cx - 5, cy + 5); g.closePath(); g.fill();
  for (const c of t.radar) {
    const x = cx + c.x * R, y = cy - c.y * R;
    if (c.type === 'missile') {
      g.fillStyle = '#ff4a3c';
      g.fillRect(x - 2.5, y - 2.5, 5, 5);
    } else {
      g.fillStyle = c.type === 'target' ? '#ffb840' : 'rgba(255, 184, 64, 0.7)';
      g.beginPath(); g.arc(x, y, c.type === 'target' ? 5 : 3.5, 0, Math.PI * 2); g.fill();
      if (c.type === 'target') { g.strokeStyle = '#ffb840'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke(); }
    }
  }
}

// ----------------------------------------------------------- touch controls
function setupTouch() {
  const stick = $('#stick');
  const knob = stick.querySelector('.stick-knob');
  let id = null, ox = 0, oy = 0;
  const R = 60;
  const move = (x, y) => {
    let dx = x - ox, dy = y - oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const [ax, ay] = applyDeadzone(dx / R, dy / R, 0.12);
    sim.setInput('roll', ax);
    sim.setInput('pitch', ay);
  };
  stick.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    stick.setPointerCapture(id);
    const r = stick.getBoundingClientRect();
    ox = r.left + r.width / 2; oy = r.top + r.height / 2;
    move(e.clientX, e.clientY);
    audio.ensure();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e.clientX, e.clientY); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = '';
    sim.setInput('roll', 0);
    sim.setInput('pitch', 0);
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  for (const b of $$('.tbtn')) {
    const a = b.dataset.act;
    const hold = a === 'fire' || a === 'boost';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.ensure();
      b.classList.add('down');
      sim.setInput(a, true);
    });
    const up = () => { b.classList.remove('down'); if (hold) sim.setInput(a, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
}
setupTouch();
document.addEventListener('contextmenu', (e) => { if (screen === 'play') e.preventDefault(); });

// -------------------------------------------------------------------- boot
$('#best-score').textContent = best.toLocaleString();
syncAudioLabels();
document.body.dataset.device = device;
show('title', false);
if (TEST) {
  // Patch test: skip menus and fly straight in; the engine's autopilot plays.
  setTimeout(() => startGame(), 300);
}
