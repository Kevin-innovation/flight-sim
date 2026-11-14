# CLAUDE_REPORT — t1 (Claude Code, Opus 5.5), sole writer

## Status: control presets implemented, awaiting browser verification (2026-11-14)

The MVP was committed and pushed by the orchestrator as `b45541a` on `origin/main` and `feature/flight-combat`. This change is **not committed**: the orchestrator commits and pushes after verifying it in a browser.

### Control presets: three desktop presets (mouse aim is the default)
- **New file `src/engine/controls.js`.** It is pure, with no DOM, and contains:
  - `ControlScheme`, which handles the mode logic, the persistent world-space aim, free-look offsets, wheel zoom, capture state, and the absolute-cursor fallback that uses position changes only.
  - `MouseButtons`: left is held, right and middle are single presses.
  - `applyWheel`, which is bounded to 0.6–2.2×.
  - `sanitizeSettings`, `MODES`, `MODE_LABELS` and `DEFAULT_SETTINGS`.
- **`src/simulation.js`**:
  - Canvas-only pointer, wheel, contextmenu and auxclick listeners, active only during play.
  - Pointer lock is requested on the first real click. A denial falls back gracefully.
  - Losing the lock, or the window losing focus, pauses the game and clears fire.
  - Camera poses come from the scheme.
  - Telemetry gains `controlMode`, `controlLabel`, `mouseCaptured`, `pointerLocked` and `cameraZoom`.
- **`src/engine/input.js`**: `isFormField()` lets settings controls keep their native keys. `hasStick()` lets a gamepad or touch stick override mouse aim.
- **`src/engine/hud.js`**: the gun cross is drawn at the projected nose, not the screen centre. The mouse-aim ring is white, with a tether line back to the nose. A FREE LOOK tag is shown when the view is rotated.
- **`index.html`, `src/main.js`, `src/style.css`**:
  - Controls screen with three mode buttons, a sensitivity slider and a Y-invert checkbox. Settings are saved to localStorage under `skyward.controls`.
  - Mapping tables for each preset (keyboard + mouse), plus gamepad and touch tables.
  - Pause menu gains a 조작 설정 button; back returns to the PAUSED screen.
  - HUD mode chip, and a capture hint saying the first click does not fire.
  - Menu navigation ignores form fields. The context menu is suppressed only on the game canvas.

**Browser verification hooks.** These live on `window.__skyward`, the `FlightSimulation` instance:
- `getDebugState()` returns: `mode`, `settings`, `captured`, `pointerLocked`, `zoom`, `aimDir`, `look`, `heading`, `forward`, `camera`, `cameraForward`, `cameraDistance`, `fireHeld`, `lastControls`.
- `setControlSettings({mode, sensitivity, invertY})` and `getControlSettings()`.
- `mouseMove(dx, dy)`, `mouseButton(button, down)` (returns `'capture'`, `'ok'` or `'ignored'`) and `mouseWheel(deltaY)`. These take the same paths as the DOM events.
- `isActivePlay()`.

**Tests.** `tests/controls.test.js` adds 22 tests, for 45 in total, all passing:
- settings sanitising
- left button held vs right/middle single presses, and clear
- the capture click never fires; classic needs no capture
- wheel zoom bounds and its effect on camera distance
- mouse aim:
  - moving right turns the camera at once, then the heading by more than 25°
  - **convergence, then a stable heading with no input (under 2° drift over 6 s)**
  - mouse up climbs, and Y-invert flips it
  - sensitivity scaling and the bounded offset from the nose
  - **the fallback held at an off-centre cursor stays stable**
  - keyboard roll override, and a stick override that re-syncs the aim
- free look:
  - moves only the camera, while the controls stay zero and the heading holds
  - the keyboard still flies the aircraft
  - yaw is bounded, and the view recentres
- classic passes input straight through and ignores the mouse
- mode switch and release clear held fire, presses and mouse delta
- `isFormField`

`vite build` succeeds.

**Independent verification: COMPLETE PASS.** The orchestrator t4 ran the built dist on port 7622 in headless system Chrome 146:
- **Settings UI:**
  - all three presets can be selected from the real UI
  - native slider arrow keys work
  - Y-invert toggles and is saved
  - the chosen preset survives a page reload
- **Free look:** changes the view but not the heading.
- **Mouse buttons:**
  - left held fires the cannon continuously
  - right fires one missile per press
  - middle cycles the target
  - the wheel zooms the chase camera
- **Mouse aim:** turns the heading toward the view direction.
- **Pause and resume:** pause clears the mouse capture and fire, and resume leaves no stuck fire.
- **Pointer lock denied:** the fallback works, and a stationary cursor keeps the aim stable.
- **Errors:** no console errors.
- **`pch check dist`:** passed (exit 0), loaded in 335 ms, ran at 60 fps.

Artifacts:
- `C:/Users/Kevin/AppData/Local/Temp/skyward-control-settings.png`
- `C:/Users/Kevin/AppData/Local/Temp/skyward-mouse-controls.png`

**Not verified:** play with a real controller. The gamepad Confirm path in the menus (checkbox toggles, slider does nothing) was only code-reviewed.

### Final verification (orchestrator t4, real browser on the built dist)
- Gameplay screenshot `C:/Users/Kevin/AppData/Local/Temp/skyward-final-gameplay.png`: chase view from behind the tail, the jet flying forward over the textured islands, ocean and HDRI sky, and the HUD rendered.
- No browser errors. The camera sits 43.7 m from the jet.
- UI smoke test passed: cannon, roll, missile, wave start, pause (freezes the simulation) and restart.
- Playable link given to the user: `http://127.0.0.1:7622`, served by the preview server hc `t11` (keep it running).

### Verified by me
- `npx vitest run` passes 23 of 23 tests. They cover:
  - terrain and runway
  - flight: straight and level, climb and dive, bank-to-turn, auto-level, boost
  - AI steering, wave spawning, cannon ammo and heat
  - bullet hit and kill score, locked missile hit
  - sea crash leading to game over, reset, victory after all waves
  - no AI terrain crashes over 63 s
  - telemetry shape, radar orientation
  - chase-camera distance (a regression test for the aliasing bug)
  - aircraft nose orientation for each asset convention
  - segment hit test, deadzone, RNG
- `npx vite build` succeeds. `dist/` is self-contained, uses relative paths, and includes `CREDITS.md`, `LICENSES/`, `THIRD-PARTY-NOTICES.md` and `assets/patch/*`.
- Every Patch asset file matches its published SHA-256. The download uses parallel 1 MiB ranges because the CDN throttles each connection to about 45 KB/s.

### Verified by the orchestrator (t4)
- `pch check dist --models` exited 0:
  - loaded in 520 ms
  - no console or uncaught errors
  - every file found
  - no external requests
  - 60 fps on an AMD 780M
  - all 4 GLBs read
- This is Patch's preview check only. It is **not** the Patch Desktop `test_release`, which has not been run.
- Playable link: `http://127.0.0.1:7622`, served from the built `dist/` by **hc `t11`** (a preview server with no HMR resets). It replaced the dev server `t7`. The orchestrator owns `t11`; don't start a duplicate.

### Patch recipe status
- `patch-recipe.draft.json` is a **draft** release recipe: 8 `test.checks`, `move_keys` set to W and Up, and `credits` for each asset folder. Regenerate it with `npm run recipe`.
- There is deliberately **no `patch.json`**. That file is pch project config, written by `pch init` once an authorised Patch project handle exists. No handle has been invented.
- When that happens, merge the draft's `test` and `credits` into it. No publishing without the user's instruction.

### Fixed and visually confirmed
- Jet orientation. The orange jet's source nose is -X (yaw -90°, wingspan along source Z). The red prop fighter's nose is confirmed +Z from its node data (Engine/Cowling at +Z, tail gear at -Z), so it keeps yaw 180°. A regression test covers both, and the final screenshot confirms the result.

### Still not verified
- Patch Desktop `test_release`. It needs a sign-in, plus the user's approval before any test upload or publish.
- Frame rate on mobile devices. The desktop check (AMD 780M) ran at 60 fps.
- Whether the autopilot under `?patch-test=1` reaches `enemy-destroyed` within Patch's stall window.
- Sound. Nobody has listened to it yet.
- Controller play. Nobody has played with a controller yet.

### Bugs fixed after the orchestrator's review
1. **Chase camera.** It flew about 75 km away because it shared a scratch vector with the forward direction. The camera maths now lives in `src/engine/camera.js`, and a regression test covers it.
2. **Missile tracking.** Head-on shots over-led the target and the seeker dropped lock. Time-to-intercept is now based on closing speed, with a 0.35 s seeker grace period after launch.

### Process incident
I ran a broad `taskkill //F //FI "WINDOWTITLE eq *"` while trying to stop my own stalled download. That was a mistake. `hc ls` afterwards showed t1, t4 and t6 still alive. From now on I only stop tasks by their exact id.

### Patch setup state
- `pch` 1.2.1 is installed. We are **not signed in**: the login the orchestrator started in hc `t6` expired without approval, and no login is pending. A new `pch login` needs the user's go-ahead.
- I read `pch guide` and applied its browser-game rules.
- The draft recipe is `patch-recipe.draft.json` (see above). Its credit `files` paths are relative to the release root (the contents of `dist/`).
- Nothing has been published.

### Files
`index.html`, `vite.config.js`, `package.json`, `patch-recipe.draft.json`, `src/{main,simulation,audio,style}.*`, `src/engine/{game,flight,ai,terrain,waves,input,hud,render,camera,util}.js`, `tests/simulation.test.js`, `scripts/{fetch-patch-assets,write-recipe}.mjs`, `public/{CREDITS.md,LICENSES/,assets/patch/}`, `README.md`, `AGENTS.md`, `COLLAB_CONTEXT.md`, `ASSET_CREDITS.md`, `.claude/skills/herdr-core/SKILL.md`, `.codex/skills/herdr-core/SKILL.md`, `.gitignore`.
