# CLAUDE_REPORT — t1 (Claude Code, Opus 5.5), sole writer

## Status: MVP verified playable (2026-11-14). Idle until user feedback.

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
